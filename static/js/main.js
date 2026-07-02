const socket = io();

// Stable client id (survives refresh / reconnect)
let myClientId = sessionStorage.getItem('caizijiedi_cid');
if (!myClientId) {
    myClientId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('caizijiedi_cid', myClientId);
}

// State
let myName = '';
let mySid = '';
let currentRoom = '';
let pendingRoom = '';   // room to rejoin after connect (restored from saved session)
let gameState = null;
let amIHost = false;
let myHiddenWord = '';
let myGuesses = {};
let myCenterGuess = '';

// Restore session so a page refresh can rejoin automatically
try {
    const sess = JSON.parse(sessionStorage.getItem('caizijiedi_session') || '{}');
    if (sess.name && sess.room_code) {
        myName = sess.name;
        pendingRoom = sess.room_code;
        console.log('[GC] session restored:', sess.name, sess.room_code, 'cid=', myClientId ? myClientId.slice(0,8) : null);
    } else {
        console.log('[GC] no saved session');
    }
} catch (e) {
    console.log('[GC] session restore error:', e);
}

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

let messageTimer = null;
function showMessage(msg, duration = 3000) {
    const el = document.getElementById('app-message');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(messageTimer);
    if (duration > 0) {
        messageTimer = setTimeout(() => {
            el.style.display = 'none';
            el.textContent = '';
        }, duration);
    }
}
function hideMessage() {
    const el = document.getElementById('app-message');
    el.style.display = 'none';
    el.textContent = '';
    clearTimeout(messageTimer);
}

if (pendingRoom) {
    // Hide login view while we attempt to rejoin the saved room
    document.getElementById('login-view').classList.remove('active');
    showMessage('正在重连房间…', 0);
}

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
        if (p.id === myClientId && p.is_host) amIHost = true;
        
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
    // Auto-(re)join if we have a room we belong to
    const room = currentRoom || pendingRoom;
    console.log('[GC] connect; room to rejoin=', room, 'name=', myName);
    if (room && myName) {
        socket.emit('join_room', { name: myName, room_code: room, client_id: myClientId });
    }
});

socket.on('error', (data) => {
    console.log('[GC] server error:', data.msg);
    showMessage(data.msg);
    // Room no longer exists (e.g. cleaned up after everyone left): back to login
    if (data.msg && data.msg.indexOf('不存在') !== -1) {
        sessionStorage.removeItem('caizijiedi_session');
        pendingRoom = '';
        currentRoom = '';
        hideMessage();
        switchView('login');
    }
});

socket.on('room_joined', (data) => {
    console.log('[GC] room_joined:', data.room_code);
    currentRoom = data.room_code;
    pendingRoom = '';
    sessionStorage.setItem('caizijiedi_session', JSON.stringify({ name: myName, room_code: currentRoom }));
    hideMessage();
    document.getElementById('display-room-code').innerText = currentRoom;
    switchView('game');
});

socket.on('private_info', (data) => {
    console.log('[GC] private_info:', data);
    myHiddenWord = data.hidden_word;
    document.getElementById('my-hidden-word').innerText = data.hidden_word;
    if (data.hints) {
        document.getElementById('hint1-input').value = data.hints[0] || '';
        document.getElementById('hint2-input').value = data.hints[1] || '';
    }
    myGuesses = data.guesses || {};
    myCenterGuess = data.center_guess || '';
    if (myCenterGuess) {
        document.getElementById('center-guess-input').value = myCenterGuess;
    }
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
        const me = data.players.find(p => p.id === myClientId);
        if (me && me.is_ready) {
            document.getElementById('btn-toggle-ready').innerText = '取消准备';
            document.getElementById('btn-toggle-ready').classList.replace('btn-secondary', 'btn-primary');
        } else {
            document.getElementById('btn-toggle-ready').innerText = '准备';
            document.getElementById('btn-toggle-ready').classList.replace('btn-primary', 'btn-secondary');
        }

        document.getElementById('btn-start-game').style.display = amIHost ? 'inline-block' : 'none';
        
        // Reset state
        myHiddenWord = '';
        myGuesses = {};
        myCenterGuess = '';
        document.getElementById('my-hidden-word').innerText = '';
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
        const me = data.players.find(p => p.id === myClientId);
        if (me && me.has_hints) {
            document.getElementById('btn-submit-hints').style.display = 'none';
            document.getElementById('hint-wait-msg').style.display = 'block';
            document.getElementById('hint1-input').disabled = true;
            document.getElementById('hint2-input').disabled = true;
        }
    }
    
    // GUESS PHASE
    if (data.state === 'GUESS_PHASE') {
        const me = data.players.find(p => p.id === myClientId);

        // Preserve in-progress guess values before re-render
        const savedGuesses = {};
        document.querySelectorAll('.guess-input').forEach(input => {
            savedGuesses[input.dataset.target] = input.value;
        });

        // Render guesses UI
        const container = document.getElementById('guesses-container');
        container.innerHTML = '';

        // Show own hints and hidden word first
        if (me) {
            const myIdx = data.players.findIndex(p => p.id === myClientId);
            const myColor = PLAYER_COLORS[myIdx % PLAYER_COLORS.length];
            const selfDiv = document.createElement('div');
            selfDiv.className = 'guess-row';
            selfDiv.style.setProperty('--player-color', myColor);
            selfDiv.innerHTML = `
                <p style="color: ${myColor}; margin-bottom: 10px; font-size: 1.1rem;">你的出题</p>
                <div class="result-two-col">
                    <div class="result-col">
                        <div class="guess-col-header">提示字</div>
                        <div style="display: flex; gap: 1rem;">
                            <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                                <span style="font-size: 2.5rem; line-height: 70px;">${me.hints[0]}</span>
                            </div>
                            <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                                <span style="font-size: 2.5rem; line-height: 70px;">${me.hints[1]}</span>
                            </div>
                        </div>
                    </div>
                    <div class="result-col">
                        <div class="guess-col-header">隐藏字</div>
                        <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                            <span style="font-size: 2.5rem; line-height: 70px;">${myHiddenWord}</span>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(selfDiv);
        }

        data.players.forEach((p, idx) => {
            if (p.id === myClientId) return; // Don't guess self
            const pColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];

            const div = document.createElement('div');
            div.className = 'guess-row';
            div.style.setProperty('--player-color', pColor);
            div.innerHTML = `
                <p style="color: ${pColor}; margin-bottom: 10px; font-size: 1.1rem;">玩家 ${p.name}</p>
                <div class="result-two-col">
                    <div class="result-col">
                        <div class="guess-col-header">提示字</div>
                        <div style="display: flex; gap: 1rem;">
                            <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                                <span style="font-size: 2.5rem; line-height: 70px;">${p.hints[0]}</span>
                            </div>
                            <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                                <span style="font-size: 2.5rem; line-height: 70px;">${p.hints[1]}</span>
                            </div>
                        </div>
                    </div>
                    <div class="result-col">
                        <div class="guess-col-header">隐藏字</div>
                        <div class="mi-zi-ge-wrapper" style="width: 70px; height: 70px;">
                            <input type="text" data-target="${p.id}" maxlength="1" class="guess-input" autocomplete="off" style="font-size: 2.5rem; line-height: 70px;">
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });

        // Restore preserved values (in-progress typing, or submitted on reconnect)
        document.querySelectorAll('.guess-input').forEach(input => {
            const t = input.dataset.target;
            if (savedGuesses[t] !== undefined && savedGuesses[t] !== '') {
                input.value = savedGuesses[t];
            } else if (myGuesses[t]) {
                input.value = myGuesses[t];
            }
        });
        if (myCenterGuess) {
            document.getElementById('center-guess-input').value = myCenterGuess;
        }
        
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
        
        data.players.forEach((p, idx) => {
            const pColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];
            const isCenterCorrect = p.center_guess === data.center_word;

            // Build guesses rows (label above, then two-col aligned chars)
            let guessRows = '';
            Object.entries(p.guesses).forEach(([targetId, guess]) => {
                const target = data.players.find(tp => tp.id === targetId);
                if (!target) return;
                const isHit = guess === target.hidden_word;
                guessRows += `
                    <div class="result-guess-group">
                        <div class="result-guess-label">猜 ${target.name} ${isHit ? '<span style="color:#4CAF50">✓</span>' : '<span style="color:#F44336">✗</span>'}</div>
                        <div class="result-two-col">
                            <div class="result-col">
                                <div class="mi-zi-ge-wrapper" style="width: 56px; height: 56px;">
                                    <span style="font-size: 2rem; line-height: 56px;">${guess}</span>
                                </div>
                            </div>
                            <div class="result-col">
                                <div class="mi-zi-ge-wrapper" style="width: 56px; height: 56px;">
                                    <span style="font-size: 2rem; line-height: 56px;">${target.hidden_word}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            // Center guess row
            guessRows += `
                <div class="result-guess-group">
                    <div class="result-guess-label">猜中心字 ${isCenterCorrect ? '<span style="color:#4CAF50">✓ 正确</span>' : '<span style="color:#F44336">✗ 错误</span>'}</div>
                    <div class="result-two-col">
                        <div class="result-col">
                            <div class="mi-zi-ge-wrapper" style="width: 56px; height: 56px;">
                                <span style="font-size: 2rem; line-height: 56px;">${p.center_guess}</span>
                            </div>
                        </div>
                        <div class="result-col">
                            <div class="mi-zi-ge-wrapper" style="width: 56px; height: 56px;">
                                <span style="font-size: 2rem; line-height: 56px;">${data.center_word}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const div = document.createElement('div');
            div.className = 'result-item';
            div.style.setProperty('--player-color', pColor);
            div.innerHTML = `
                <div class="result-player-name" style="color: ${pColor}; font-size: 1.3rem; font-weight: bold; margin-bottom: 12px;">
                    玩家：${p.name}<span class="score">${p.score}分</span>
                </div>
                <div class="result-two-col">
                    <div class="result-col">
                        <div class="result-col-header">提示字</div>
                        <div style="display: flex; gap: 8px;">
                            <div class="mi-zi-ge-wrapper" style="width: 64px; height: 64px;">
                                <span style="font-size: 2.2rem; line-height: 64px;">${p.hints[0]}</span>
                            </div>
                            <div class="mi-zi-ge-wrapper" style="width: 64px; height: 64px;">
                                <span style="font-size: 2.2rem; line-height: 64px;">${p.hints[1]}</span>
                            </div>
                        </div>
                    </div>
                    <div class="result-col">
                        <div class="result-col-header">隐藏字</div>
                        <div class="mi-zi-ge-wrapper" style="width: 64px; height: 64px;">
                            <span style="font-size: 2.2rem; line-height: 64px;">${p.hidden_word}</span>
                        </div>
                    </div>
                </div>
                <div class="result-divider"></div>
                <div class="result-two-col result-guess-header">
                    <div class="result-col">
                        <div class="result-col-header">猜测</div>
                    </div>
                    <div class="result-col">
                        <div class="result-col-header">正确答案</div>
                    </div>
                </div>
                ${guessRows || '<p style="color: var(--text-light); font-size: 0.9rem; padding: 4px 0;">无</p>'}
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
    if (!name) return showMessage('请输入名字');
    myName = name;
    switchView('lobby');
});

document.getElementById('btn-create-room').addEventListener('click', () => {
    socket.emit('create_room', { name: myName, client_id: myClientId });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim();
    if (code.length === 0) return showMessage('请输入成语房间名');
    socket.emit('join_room', { name: myName, room_code: code, client_id: myClientId });
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
    if (!hint1 || !hint2) return showMessage('请输入两个提示字');
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
    
    if (!allFilled) return showMessage('请填完所有的猜测和中心字猜测');
    
    socket.emit('submit_guesses', { guesses, center_guess: centerGuess });
});

document.getElementById('btn-restart-game').addEventListener('click', () => {
    socket.emit('restart_game');
});
