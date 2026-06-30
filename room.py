import random
import json

class Room:
    def __init__(self, room_code):
        self.room_code = room_code
        self.players = {} # sid -> { name, sid, score, is_host, hidden_word, hints: ['', ''], guesses: {}, center_guess: '' }
        self.state = 'LOBBY' # LOBBY, HINT_PHASE, GUESS_PHASE, RESULT_PHASE
        self.center_word = ''
        self.round_number = 1
        
        with open('words.json', 'r', encoding='utf-8') as f:
            self.word_bank = json.load(f)

    def add_player(self, sid, name):
        is_host = len(self.players) == 0
        
        base_name = name
        index = 1
        existing_names = [p['name'] for p in self.players.values()]
        while name in existing_names:
            name = f"{base_name}的分身{index}"
            index += 1
            
        self.players[sid] = {
            'sid': sid,
            'name': name,
            'score': 0,
            'is_host': is_host,
            'is_ready': False,
            'hidden_word': '',
            'hints': ['', ''],
            'guesses': {}, # target_sid -> guessed word
            'center_guess': ''
        }
        
    def remove_player(self, sid):
        if sid in self.players:
            was_host = self.players[sid]['is_host']
            del self.players[sid]
            # reassign host
            if was_host and len(self.players) > 0:
                list(self.players.values())[0]['is_host'] = True

    def start_game(self):
        if len(self.players) < 2:
            return False
            
        self.state = 'HINT_PHASE'
        # Assign words
        word_set = random.choice(self.word_bank)
        self.center_word = word_set['center']
        
        available_hidden = random.sample(word_set['hidden'], len(self.players))
        
        for i, player in enumerate(self.players.values()):
            player['hidden_word'] = available_hidden[i]
            player['hints'] = ['', '']
            player['guesses'] = {}
            player['center_guess'] = ''
            player['is_ready'] = False
            
        return True

    def toggle_ready(self, sid):
        if self.state == 'LOBBY' and sid in self.players:
            self.players[sid]['is_ready'] = not self.players[sid]['is_ready']
            return True
        return False

    def submit_hints(self, sid, hint1, hint2):
        if self.state != 'HINT_PHASE': return False
        if not hint1 or not hint2: return False
        
        self.players[sid]['hints'] = [hint1, hint2]
        
        # Check if all submitted
        all_submitted = all(p['hints'][0] != '' for p in self.players.values())
        if all_submitted:
            self.state = 'GUESS_PHASE'
        return True

    def submit_guesses(self, sid, guesses, center_guess):
        if self.state != 'GUESS_PHASE': return False
        self.players[sid]['guesses'] = guesses
        self.players[sid]['center_guess'] = center_guess
        
        # Check if all submitted (guests have non-empty guesses dict)
        all_submitted = all(p['center_guess'] != '' for p in self.players.values())
        if all_submitted:
            self.calculate_scores()
            self.state = 'RESULT_PHASE'
        return True

    def calculate_scores(self):
        for sid, p in self.players.items():
            # Guessing center word +3
            if p['center_guess'] == self.center_word:
                p['score'] += 3
                
            for target_sid, guess in p['guesses'].items():
                if target_sid != sid and target_sid in self.players:
                    target_hidden = self.players[target_sid]['hidden_word']
                    if guess == target_hidden:
                        p['score'] += 1 # I guessed it correctly
                        self.players[target_sid]['score'] += 1 # My word was guessed

    def reset_lobby(self):
        self.state = 'LOBBY'
        for p in self.players.values():
            p['hidden_word'] = ''
            p['hints'] = ['', '']
            p['guesses'] = {}
            p['center_guess'] = ''
            p['is_ready'] = False
            # we keep scores!
            
    def get_public_state(self):
        return {
            'room_code': self.room_code,
            'state': self.state,
            'players': [
                {
                    'sid': p['sid'],
                    'name': p['name'],
                    'score': p['score'],
                    'is_host': p['is_host'],
                    'is_ready': p['is_ready'],
                    'has_hints': p['hints'][0] != '',
                    'has_guesses': p['center_guess'] != '',
                    # Only reveal hints in guess/result phase
                    'hints': p['hints'] if self.state in ['GUESS_PHASE', 'RESULT_PHASE'] else ['', ''],
                    # Only reveal hidden words in result phase
                    'hidden_word': p['hidden_word'] if self.state == 'RESULT_PHASE' else '',
                    'center_guess': p['center_guess'] if self.state == 'RESULT_PHASE' else '',
                    'guesses': p['guesses'] if self.state == 'RESULT_PHASE' else {}
                }
                for p in self.players.values()
            ],
            'center_word': self.center_word if self.state == 'RESULT_PHASE' else ''
        }
