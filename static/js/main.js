const socket = io();

// State
let myName = '';
let mySid = '';
let currentRoom = '';
let gameState = null;
let amIHost = false;

const PLAYER_COLORS = ['#B22222', '#2C5F8A', '#3A7D5E', '#8B6914', '#6B3FA0', '#C75B39'];

// DOM Elements
const views = {
    login: document.getElementById('login-view'),
    lobby: document.getElementById('lobby-view'),
    game: document.getElementById('game-view')
};

const phases = {
    LOBBY: document.getElementById('phase-lobby'),
    HINT_PHASE: document.getElementById('phase-hint'),
    GUESS_PHASE: document.getElementById('phase-guess'),
    RESULT_PHASE: document.getElementById('phase-result')
};

// Switch active view
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// Switch active phase in game
function switchPhase(phaseName) {
    Object.values(phases).forEach(p => p.style.display = 'none');
    if (phases[phaseName]) {
        phases[phaseName].style.display = 'block';
    }
    
    // Update badge
    const badge = document.getElementById('display-state-badge');
    const phaseNames = {
        'LOBBY': '等待中',
        'HINT_PHASE': '出题阶段',
        'GUESS_PHASE': '猜测阶段',
        'RESULT_PHASE': '结算阶段'
    };
    badge.innerText = phaseNames[phaseName] || '未知';
}

// Render Players List
function renderPlayers(players) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    
    amIHost = false;
    
    players.forEach((p, idx) => {
        const pColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];
        if (p.sid === mySid && p.is_host) amIHost = true;
        
        const tag = document.createElement('div');
        tag.className = 'player-tag';
        tag.style.setProperty('--player-color', pColor);
        if (p.is_host) tag.classList.add('is-host');
        if (p.has_hints || p.has_guesses) tag.classList.add('ready');
        if (p.is_ready) tag.classList.add('is-ready');
        
        tag.innerHTML = `
            <span style="color: ${pColor}; font-weight: bold;">${p.name}</span>
            ${p.is_host ? '<span style="color: var(--ink); border: 1px solid var(--ink); padding: 0 6px; border-radius: 3px; font-size: 0.75rem; margin-left: 6px;">房主</span>' : ''}
            <span style="margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--text-light);">
                ${p.is_ready ? '<span style="color:#2D7D3F;">准备</span>' : ''}
                <span>${p.score}分</span>
            </span>
        `;
        list.appendChild(tag);
    });
}

// Socket Events
socket.on('connect', () => {
    mySid = socket.id;
});

socket.on('error', (data) => {
    alert(data.msg);
});

socket.on('room_joined', (data) => {
    currentRoom = data.room_code;
    document.getElementById('display-room-code').innerText = currentRoom;
    switchView('game');
});

socket.on('private_info', (data) => {
    document.getElementById('my-hidden-word').innerText = data.hidden_word;
});

socket.on('update_state', (data) => {
    gameState = data;
    renderPlayers(data.players);
    switchPhase(data.state);
    
    // LOBBY PHASE
    if (data.state === 'LOBBY') {
        const readyCount = data.players.filter(p => p.is_ready).length;
        document.getElementById('ready-status').style.display = 'block';
        document.getElementById('ready-count').innerText = readyCount;
        document.getElementById('total-count').innerText = data.players.length;
        
        document.getElementById('btn-toggle-ready').style.display = 'inline-block';
        const me = data.players.find(p => p.sid === mySid);
        if (me && me.is_ready) {
            document.getElementById('btn-toggle-ready').innerText = '取消准备';
            document.getElementById('btn-toggle-ready').classList.replace('btn-secondary', 'btn-primary');
        } else {
            document.getElementById('btn-toggle-ready').innerText = '准备';
            document.getElementById('btn-toggle-ready').classList.replace('btn-primary', 'btn-secondary');
        }

        document.getElementById('btn-start-game').style.display = amIHost ? 'inline-block' : 'none';
        
        // Reset inputs
        document.getElementById('hint1-input').value = '';
        document.getElementById('hint2-input').value = '';
        document.getElementById('center-guess-input').value = '';
        document.getElementById('hint1-input').disabled = false;
        document.getElementById('hint2-input').disabled = false;
        document.getElementById('center-guess-input').disabled = false;
        document.getElementById('hint-wait-msg').style.display = 'none';
        document.getElementById('btn-submit-hints').style.display = 'inline-block';
        document.getElementById('guess-wait-msg').style.display = 'none';
        document.getElementById('btn-submit-guesses').style.display = 'inline-block';
    } else {
        document.getElementById('ready-status').style.display = 'none';
    }
    
    // HINT PHASE
    if (data.state === 'HINT_PHASE') {
        const me = data.players.find(p => p.sid === mySid);
        if (me && me.has_hints) {
            document.getElementById('btn-submit-hints').style.display = 'none';
            document.getElementById('hint-wait-msg').style.display = 'block';
            document.getElementById('hint1-input').disabled = true;
            document.getElementById('hint2-input').disabled = true;
        }
    }
    
    // GUESS PHASE
    if (data.state === 'GUESS_PHASE') {
        const me = data.players.find(p => p.sid === mySid);
        
        // Render guesses UI
        const container = document.getElementById('guesses-container');
        container.innerHTML = '';
        
        data.players.forEach((p, idx) => {
            if (p.sid === mySid) return; // Don't guess self
            const pColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];
            
            const div = document.createElement('div');
            div.className = 'guess-row';
            div.style.setProperty('--player-color', pColor);
            div.innerHTML = `
                <p style="color: var(--player-color); margin-bottom: 10px;">玩家 <strong>${p.name}</strong> 的提示字：</p>
                <div class="mi-zi-ge-container" style="justify-content: flex-start; gap: 1rem;">
                    <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                        <span style="font-size: 2.5rem; line-height: 70px;">${p.hints[0]}</span>
                    </div>
                    <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                        <span style="font-size: 2.5rem; line-height: 70px;">${p.hints[1]}</span>
                    </div>
                    <div style="display: flex; align-items: center; font-size: 2rem; color: #666; margin: 0 10px;">➜</div>
                    <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                        <input type="text" data-target="${p.sid}" maxlength="1" class="guess-input" autocomplete="off" style="font-size: 2.5rem; line-height: 70px;">
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
        
        if (me && me.has_guesses) {
            document.getElementById('btn-submit-guesses').style.display = 'none';
            document.getElementById('guess-wait-msg').style.display = 'block';
            document.querySelectorAll('.guess-input').forEach(input => { input.disabled = true; });
            document.getElementById('center-guess-input').disabled = true;
        }
    }
    
    // RESULT PHASE
    if (data.state === 'RESULT_PHASE') {
        document.getElementById('result-center-word').innerText = data.center_word;
        
        const container = document.getElementById('result-container');
        container.innerHTML = '';
        
        data.players.forEach(p => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `
                <h4>${p.name}</h4>
                <p>隐藏字：<strong>${p.hidden_word}</strong> &nbsp;|&nbsp; 提示：【${p.hints[0]}】【${p.hints[1]}】</p>
                <p>猜中心字：${p.center_guess === data.center_word ? '<span style="color:#4CAF50">正确</span>' : '<span style="color:#F44336">错误 ('+p.center_guess+')</span>'}</p>
                <span class="score">总分: ${p.score}</span>
            `;
            container.appendChild(div);
        });
        
        document.getElementById('btn-restart-game').style.display = amIHost ? 'inline-block' : 'none';
    }
});


// Filter non-Chinese characters from mi-zi-ge inputs
document.addEventListener('input', (e) => {
    if (e.target.matches('#hint1-input, #hint2-input, #center-guess-input, .guess-input')) {
        e.target.value = e.target.value.replace(/[^一-鿿]/g, '');
    }
});

// Event Listeners
document.getElementById('btn-enter').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) return alert('请输入名字');
    myName = name;
    switchView('lobby');
});

document.getElementById('btn-create-room').addEventListener('click', () => {
    socket.emit('create_room', { name: myName });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim();
    if (code.length === 0) return alert('请输入成语房间名');
    socket.emit('join_room', { name: myName, room_code: code });
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom).then(() => {
        const btn = document.getElementById('btn-copy-code');
        btn.innerText = '已复制';
        setTimeout(() => btn.innerText = '复制', 2000);
    });
});

document.getElementById('btn-toggle-ready').addEventListener('click', () => {
    socket.emit('toggle_ready');
});

document.getElementById('btn-start-game').addEventListener('click', () => {
    socket.emit('start_game');
});

document.getElementById('btn-submit-hints').addEventListener('click', () => {
    const hint1 = document.getElementById('hint1-input').value.trim();
    const hint2 = document.getElementById('hint2-input').value.trim();
    if (!hint1 || !hint2) return alert('请输入两个提示字');
    socket.emit('submit_hints', { hint1, hint2 });
});

document.getElementById('btn-submit-guesses').addEventListener('click', () => {
    const inputs = document.querySelectorAll('.guess-input');
    const guesses = {};
    let allFilled = true;
    
    inputs.forEach(input => {
        const val = input.value.trim();
        if (!val) allFilled = false;
        guesses[input.dataset.target] = val;
    });
    
    const centerGuess = document.getElementById('center-guess-input').value.trim();
    if (!centerGuess) allFilled = false;
    
    if (!allFilled) return alert('请填完所有的猜测和中心字猜测');
    
    socket.emit('submit_guesses', { guesses, center_guess: centerGuess });
});

document.getElementById('btn-restart-game').addEventListener('click', () => {
    socket.emit('restart_game');
});
