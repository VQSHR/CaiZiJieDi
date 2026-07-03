from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import os
import random
import json
import time
from room import Room

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-only-secret-change-me')
app.config['TEMPLATES_AUTO_RELOAD'] = True
socketio = SocketIO(app)

rooms = {}  # room_code -> Room instance
sid_to_room = {}  # sid -> room_code
urge_cooldowns = {}  # client_id -> last urge timestamp
URGE_COOLDOWN = 5.0  # seconds between urges from the same client

with open('idioms.json', 'r', encoding='utf-8') as f:
    idioms_list = json.load(f)


def generate_room_code():
    while True:
        code = random.choice(idioms_list)
        if code not in rooms:
            return code


def schedule_room_cleanup(room_code, delay=120):
    """Delete the room if it still has no connected players after a grace period."""
    def cleanup():
        socketio.sleep(delay)
        if room_code in rooms:
            connected = [p for p in rooms[room_code].players.values() if p['connected']]
            if not connected:
                del rooms[room_code]
    socketio.start_background_task(cleanup)


@app.route('/')
def index():
    return render_template('index.html')


@socketio.on('create_room')
def on_create_room(data):
    name = data.get('name')
    client_id = data.get('client_id')
    if not name or not client_id:
        return
    room_code = generate_room_code()
    rooms[room_code] = Room(room_code)

    join_room(room_code)
    sid_to_room[request.sid] = room_code
    rooms[room_code].add_player(client_id, request.sid, name)

    emit('room_joined', {'room_code': room_code})
    emit('update_state', rooms[room_code].get_public_state(), to=room_code)


@socketio.on('join_room')
def on_join_room(data):
    name = data.get('name')
    room_code = data.get('room_code', '').strip()
    client_id = data.get('client_id')
    if not name or not client_id or room_code not in rooms:
        emit('error', {'msg': '房间不存在或信息不全'})
        return

    room = rooms[room_code]
    is_reconnect = client_id in room.players
    spectator = bool(data.get('spectator'))

    if not is_reconnect and room.state != 'LOBBY':
        # Game in progress: a brand-new joiner must spectate (with confirmation)
        if not spectator:
            emit('spectator_prompt', {'room_code': room_code}, to=request.sid)
            return
        # spectator=True: fall through and add as spectator

    join_room(room_code)
    sid_to_room[request.sid] = room_code
    room.add_player(client_id, request.sid, name, spectator=spectator and not is_reconnect)

    emit('room_joined', {'room_code': room_code})

    # On reconnect mid-game, restore private info BEFORE the state broadcast,
    # so the client renders its own hidden word / submitted hints on first paint
    p = room.get_player_by_sid(request.sid)
    if p and (p['hidden_word'] or p['center_guess']):
        emit('private_info', {
            'hidden_word': p['hidden_word'],
            'hints': p['hints'],
            'guesses': p['guesses'],
            'center_guess': p['center_guess']
        }, to=request.sid)

    emit('update_state', room.get_public_state(), to=room_code)


@socketio.on('disconnect')
def on_disconnect():
    room_code = sid_to_room.pop(request.sid, None)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    room.disconnect_player(request.sid)  # mark connected=False, keep data, reassign host
    leave_room(room_code)
    connected = [p for p in room.players.values() if p['connected']]
    if connected:
        emit('update_state', room.get_public_state(), to=room_code)
    else:
        # No one connected: keep the room briefly to allow reconnect, then clean up
        schedule_room_cleanup(room_code)


@socketio.on('exit_room')
def on_exit_room():
    room_code = sid_to_room.pop(request.sid, None)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    p = room.get_player_by_sid(request.sid)
    if p:
        room.remove_player(p['client_id'])  # mark left (ghost), keep data for the round
    leave_room(room_code)
    connected = [p for p in room.players.values() if p['connected']]
    if connected:
        emit('update_state', room.get_public_state(), to=room_code)
    else:
        schedule_room_cleanup(room_code)


@socketio.on('start_game')
def on_start_game():
    room_code = sid_to_room.get(request.sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    p = room.get_player_by_sid(request.sid)
    if not (p and p['is_host']):
        return
    connected = [pl for pl in room.players.values() if pl['connected'] and not pl['is_spectator']]
    if not all(pl['is_ready'] for pl in connected):
        emit('error', {'msg': '所有玩家准备后才能开始'}, to=request.sid)
        return
    if room.start_game():
        emit('update_state', room.get_public_state(), to=room_code)
        for pl in room.players.values():
            if pl['connected']:
                emit('private_info', {
                    'hidden_word': pl['hidden_word'],
                    'hints': pl['hints'],
                    'guesses': pl['guesses'],
                    'center_guess': pl['center_guess']
                }, to=pl['sid'])
    else:
        emit('error', {'msg': '人数不足，需要至少2人'}, to=request.sid)


@socketio.on('toggle_ready')
def on_toggle_ready():
    room_code = sid_to_room.get(request.sid)
    if room_code and room_code in rooms:
        room = rooms[room_code]
        if room.toggle_ready(request.sid):
            emit('update_state', room.get_public_state(), to=room_code)


@socketio.on('submit_hints')
def on_submit_hints(data):
    room_code = sid_to_room.get(request.sid)
    if room_code and room_code in rooms:
        room = rooms[room_code]
        hint1 = data.get('hint1', '').strip()
        hint2 = data.get('hint2', '').strip()
        if room.submit_hints(request.sid, hint1, hint2):
            emit('update_state', room.get_public_state(), to=room_code)


@socketio.on('submit_guesses')
def on_submit_guesses(data):
    room_code = sid_to_room.get(request.sid)
    if room_code and room_code in rooms:
        room = rooms[room_code]
        guesses = data.get('guesses', {})
        center_guess = data.get('center_guess', '').strip()
        if room.submit_guesses(request.sid, guesses, center_guess):
            emit('update_state', room.get_public_state(), to=room_code)


@socketio.on('restart_game')
def on_restart_game():
    room_code = sid_to_room.get(request.sid)
    if room_code and room_code in rooms:
        room = rooms[room_code]
        p = room.get_player_by_sid(request.sid)
        if p and p['is_host']:
            room.reset_lobby()
            emit('update_state', room.get_public_state(), to=room_code)


@socketio.on('urge')
def on_urge(data):
    room_code = sid_to_room.get(request.sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    p = room.get_player_by_sid(request.sid)
    if not p:
        return
    now = time.time()
    if now - urge_cooldowns.get(p['client_id'], 0) < URGE_COOLDOWN:
        emit('error', {'msg': '催促太频繁，稍后再试'}, to=request.sid)
        return
    urge_cooldowns[p['client_id']] = now
    emit('urge', {'from': p['name'], 'text': data.get('text', '快点！')}, to=room_code)


@socketio.on('throw_tomato')
def on_throw_tomato(data):
    room_code = sid_to_room.get(request.sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    p = room.get_player_by_sid(request.sid)
    if not p:
        return
    target = data.get('target_id', '')
    tp = room.players.get(target)
    target_name = tp['name'] if tp else '?'
    emit('throw_tomato', {
        'from': p['name'],
        'from_id': p['client_id'],
        'target_id': target,
        'target_name': target_name
    }, to=room_code)


if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes')
    port = int(os.getenv('PORT', '5000'))
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
