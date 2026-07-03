import random
import json


class Room:
    def __init__(self, room_code):
        self.room_code = room_code
        self.players = {}  # client_id -> player dict
        self.state = 'LOBBY'  # LOBBY, HINT_PHASE, GUESS_PHASE, RESULT_PHASE
        self.center_word = ''
        self.round_number = 1

        with open('words.json', 'r', encoding='utf-8') as f:
            self.word_bank = json.load(f)

    def add_player(self, client_id, sid, name, spectator=False):
        if client_id in self.players:
            # Reconnect: update socket sid, mark connected, keep all state
            p = self.players[client_id]
            p['sid'] = sid
            p['connected'] = True
            return
        # New player: host only if the room has no host yet and not a spectator
        is_host = not spectator and not any(p['is_host'] for p in self.players.values())

        base_name = name
        index = 1
        existing_names = [p['name'] for p in self.players.values()]
        while name in existing_names:
            name = f"{base_name}的分身{index}"
            index += 1

        self.players[client_id] = {
            'client_id': client_id,
            'sid': sid,
            'name': name,
            'score': 0,
            'is_host': is_host,
            'is_ready': spectator,  # spectators don't need to ready
            'connected': True,
            'is_spectator': spectator,
            'hidden_word': '',
            'hints': ['', ''],
            'guesses': {},  # target_client_id -> guessed word
            'center_guess': ''
        }

    def get_player_by_sid(self, sid):
        for p in self.players.values():
            if p['sid'] == sid:
                return p
        return None

    def disconnect_player(self, sid):
        p = self.get_player_by_sid(sid)
        if not p:
            return None
        p['connected'] = False
        if p['is_host']:
            # Hand host to another connected player
            for other in self.players.values():
                if other['client_id'] != p['client_id'] and other['connected']:
                    other['is_host'] = True
                    p['is_host'] = False
                    break
        return p['client_id']

    def cleanup_player(self, client_id):
        """Remove a still-disconnected player (called after grace period)."""
        p = self.players.get(client_id)
        if not p or p['connected']:
            return False
        was_host = p['is_host']
        del self.players[client_id]
        if was_host and self.players:
            for other in self.players.values():
                if other['connected']:
                    other['is_host'] = True
                    break
        return True

    def remove_player(self, client_id):
        """Mark a player as left (ghost): keep their hidden word/hints/guesses for
        the rest of the round, but mark disconnected and free the socket sid so the
        live socket can be reused. Host is handed off if needed."""
        p = self.players.get(client_id)
        if not p:
            return False
        p['connected'] = False
        p['sid'] = None
        if p['is_host']:
            for other in self.players.values():
                if other['client_id'] != client_id and other['connected']:
                    other['is_host'] = True
                    p['is_host'] = False
                    break
        return True

    def start_game(self):
        connected = [p for p in self.players.values() if p['connected'] and not p['is_spectator']]
        if len(connected) < 2:
            return False

        self.state = 'HINT_PHASE'
        word_set = random.choice(self.word_bank)
        self.center_word = word_set['center']

        available_hidden = random.sample(word_set['hidden'], len(connected))

        for i, player in enumerate(connected):
            player['hidden_word'] = available_hidden[i]
        # Reset round state for everyone (players + spectators)
        for p in self.players.values():
            p['hints'] = ['', '']
            p['guesses'] = {}
            p['center_guess'] = ''
            p['is_ready'] = False

        return True

    def toggle_ready(self, sid):
        if self.state == 'LOBBY':
            p = self.get_player_by_sid(sid)
            if p:
                p['is_ready'] = not p['is_ready']
                return True
        return False

    def submit_hints(self, sid, hint1, hint2):
        if self.state != 'HINT_PHASE':
            return False
        if not hint1 or not hint2:
            return False
        p = self.get_player_by_sid(sid)
        if not p or p['is_spectator']:
            return False
        p['hints'] = [hint1, hint2]
        connected = [pl for pl in self.players.values() if pl['connected'] and not pl['is_spectator']]
        if all(pl['hints'][0] != '' for pl in connected):
            self.state = 'GUESS_PHASE'
        return True

    def submit_guesses(self, sid, guesses, center_guess):
        if self.state != 'GUESS_PHASE':
            return False
        p = self.get_player_by_sid(sid)
        if not p:
            return False
        p['guesses'] = guesses
        p['center_guess'] = center_guess
        # Phase advances when all regular (non-spectator) connected players submitted
        connected = [pl for pl in self.players.values() if pl['connected'] and not pl['is_spectator']]
        if all(pl['center_guess'] != '' for pl in connected):
            self.calculate_scores()
            self.state = 'RESULT_PHASE'
        return True

    def calculate_scores(self):
        for p in self.players.values():
            if p['center_guess'] == self.center_word:
                p['score'] += 3
            for target_id, guess in p['guesses'].items():
                if target_id != p['client_id'] and target_id in self.players:
                    target = self.players[target_id]
                    if guess == target['hidden_word']:
                        p['score'] += 1
                        # Spectator guesses only score the spectator; don't reward the target
                        if not p['is_spectator']:
                            target['score'] += 1

    def reset_lobby(self):
        self.state = 'LOBBY'
        # Drop players who left/disconnected during the round (ghosts)
        for cid in [c for c, p in self.players.items() if not p['connected']]:
            del self.players[cid]
        for p in self.players.values():
            p['hidden_word'] = ''
            p['hints'] = ['', '']
            p['guesses'] = {}
            p['center_guess'] = ''
            p['is_ready'] = False
            p['is_spectator'] = False  # spectators become regular players next round
            # scores are kept across rounds

    def get_public_state(self):
        return {
            'room_code': self.room_code,
            'state': self.state,
            'players': [
                {
                    'id': p['client_id'],
                    'name': p['name'],
                    'score': p['score'],
                    'is_host': p['is_host'],
                    'is_ready': p['is_ready'],
                    'connected': p['connected'],
                    'is_spectator': p['is_spectator'],
                    'has_hints': p['hints'][0] != '',
                    'has_guesses': p['center_guess'] != '',
                    'hints': p['hints'] if self.state in ['GUESS_PHASE', 'RESULT_PHASE'] else ['', ''],
                    'hidden_word': p['hidden_word'] if self.state == 'RESULT_PHASE' else '',
                    'center_guess': p['center_guess'] if self.state == 'RESULT_PHASE' else '',
                    'guesses': p['guesses'] if self.state == 'RESULT_PHASE' else {}
                }
                for p in self.players.values()
            ],
            'center_word': self.center_word if self.state == 'RESULT_PHASE' else ''
        }
