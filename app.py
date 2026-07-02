from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import os
import random
import string
import json
from room import Room

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-only-secret-change-me')
app.config['TEMPLATES_AUTO_RELOAD'] = True
socketio = SocketIO(app)

rooms = {} # room_code -> Room instance
sid_to_room = {} # sid -> room_code

with open('idioms.json', 'r', encoding='utf-8') as f:
    idioms_list = json.load(f)

def generate_room_code():
    while True:
        code = random.choice(idioms_list)
        if code not in rooms:
            return code

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('create_room')
def on_create_room(data):
    name = data.get('name')
    if not name: return
    room_code = generate_room_code()
    rooms[room_code] = Room(room_code)
    
    join_room(room_code)
    sid_to_room[request.sid] = room_code
    rooms[room_code].add_player(request.sid, name)
    
    emit('room_joined', {'room_code': room_code, 'sid': request.sid})
    emit('update_state', rooms[room_code].get_public_state(), to=room_code)

@socketio.on('join_room')
def on_join_room(data):
    name = data.get('name')
    room_code = data.get('room_code', '').strip()
    if not name or room_code not in rooms:
        emit('error', {'msg': '房间不存在或信息不全'})
        return
        
    if rooms[room_code].state != 'LOBBY':
        emit('error', {'msg': '该房间的游戏正在进行中，无法中途加入'})
        return
        
    join_room(room_code)
    sid_to_room[request.sid] = room_code
    rooms[room_code].add_player(request.sid, name)
    
    emit('room_joined', {'room_code': room_code, 'sid': request.sid})
    emit('update_state', rooms[room_code].get_public_state(), to=room_code)

@socketio.on('disconnect')
def on_disconnect():
    room_code = sid_to_room.get(request.sid)
    if room_code and room_code in rooms:
        room = rooms[room_code]
        room.remove_player(request.sid)
        leave_room(room_code)
        del sid_to_room[request.sid]
        
        if len(room.players) == 0:
            del rooms[room_code]
        else:
            emit('update_state', room.get_public_state(), to=room_code)

@socketio.on('start_game')
def on_start_game():
    room_code = sid_to_room.get(request.sid)
    if room_code and room_code in rooms:
        room = rooms[room_code]
        if room.players[request.sid]['is_host']:
            all_ready = all(p['is_ready'] for p in room.players.values())
            if not all_ready:
                emit('error', {'msg': '所有玩家准备后才能开始'}, to=request.sid)
                return
            if room.start_game():
                emit('update_state', room.get_public_state(), to=room_code)
                # Send private info to each player
                for sid, p in room.players.items():
                    emit('private_info', {'hidden_word': p['hidden_word']}, to=sid)
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
        if room.players[request.sid]['is_host']:
            room.reset_lobby()
            emit('update_state', room.get_public_state(), to=room_code)

if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes')
    port = int(os.getenv('PORT', '5000'))
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
