from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import os
import random
import json
from room import Room

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-only-secret-change-me')
app.config['TEMPLATES_AUTO_RELOAD'] = True
socketio = SocketIO(app)

rooms = {}  # room_code -> Room instance
sid_to_room = {}  # sid -> room_code

with open('idioms.json', 'r', encoding='utf-8') as f:
    idioms_list = json.load(f)


def generate_room_code():
    while True:
        code = random.choice(idioms_list)
        if code not in rooms:
            return code


def schedule_player_cleanup(room_code, client_id, delay=120):
    """Remove a player that stayed disconnected past the grace period."""
    def cleanup():
        socketio.sleep(delay)
        if room_code in rooms:
            room = rooms[room_code]
            if room.cleanup_player(client_id):
                if not room.players:
                    del rooms[room_code]
                else:
                    socketio.emit('update_state', room.get_public_state(), to=room_code)
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
    if not is_reconnect and room.state != 'LOBBY':
        emit('error', {'msg': '该房间的游戏正在进行中，无法中途加入'})
        return

    join_room(room_code)
    sid_to_room[request.sid] = room_code
    room.add_player(client_id, request.sid, name)

    emit('room_joined', {'room_code': room_code})

    # On reconnect mid-game, restore private info BEFORE the state broadcast,
    # so the client renders its own hidden word / submitted hints on first paint
    p = room.get_player_by_sid(request.sid)
    if p and p['hidden_word']:
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
    client_id = room.disconnect_player(request.sid)
    leave_room(room_code)

    if client_id:
        # Keep the player around for a grace period to allow reconnect
        schedule_player_cleanup(room_code, client_id)

    connected = [p for p in room.players.values() if p['connected']]
    if connected:
        emit('update_state', room.get_public_state(), to=room_code)


@socketio.on('start_game')
def on_start_game():
    room_code = sid_to_room.get(request.sid)
    if not room_code or room_code not in rooms:
        return
    room = rooms[room_code]
    p = room.get_player_by_sid(request.sid)
    if not (p and p['is_host']):
        return
    connected = [pl for pl in room.players.values() if pl['connected']]
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


if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes')
    port = int(os.getenv('PORT', '5000'))
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
