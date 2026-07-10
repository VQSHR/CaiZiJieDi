const socket = io();

// Stable client id (survives refresh / reconnect)
let myClientId = sessionStorage.getItem('caizijiedi_cid');
if (!myClientId) {
    myClientId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('caizijiedi_cid', myClientId);
}

const URGE_TEXTS = [
    '快点啊，等得花儿都谢了！',
    '你怎么这么慢啊',
    '出牌啊，别磨蹭',
    '我杯子都喝完了',
    '老板，搞快点',
    '再不出我就要睡着了',
    '你是用脚在打字吗？',
    '快快快，雷打不动',
    '我等得都长蘑菇了',
    '能不能有点效率',
    '催催催，再不交我走了',
    '快点，我的番茄都准备好了',
];

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

// Pop a speech bubble (urge message) at the top of the screen
function showUrgeBubble(from, text) {
    const b = document.createElement('div');
    b.className = 'urge-bubble';
    b.innerHTML = `<span class="from">${from}:</span>${text}`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3500);
}

// A plain note bubble (e.g. someone threw a tomato)
function showNoteBubble(text) {
    const b = document.createElement('div');
    b.className = 'urge-bubble';
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2600);
}

// Tomato flies from the sender's player tag to the target's player tag, then splashes
function flyTomato(fromId, targetId, fromName) {
    const fromTag = document.querySelector(`#players-list .player-tag[data-pid="${fromId}"]`);
    const toTag = document.querySelector(`#players-list .player-tag[data-pid="${targetId}"]`);
    if (!fromTag || !toTag) {
        // Fallback: if I'm the target, just show a center splash
        if (targetId === myClientId) showTomato(fromName);
        return;
    }
    const r1 = fromTag.getBoundingClientRect();
    const r2 = toTag.getBoundingClientRect();
    const x1 = r1.left + r1.width / 2, y1 = r1.top + r1.height / 2;
    const x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;

    const tomato = document.createElement('div');
    tomato.textContent = '🍅';
    tomato.style.cssText = `position:fixed;left:${x1}px;top:${y1}px;font-size:2.2rem;z-index:1200;transform:translate(-50%,-50%) rotate(0deg);pointer-events:none;transition:left 0.8s cubic-bezier(.4,0,.6,1),top 0.8s cubic-bezier(.4,0,.6,1),transform 0.8s ease-in;`;
    document.body.appendChild(tomato);
    // Force reflow so the transition triggers from the start position
    void tomato.offsetWidth;
    tomato.style.left = x2 + 'px';
    tomato.style.top = y2 + 'px';
    tomato.style.transform = 'translate(-50%,-50%) rotate(720deg)';

    setTimeout(() => {
        tomato.remove();
        splashAt(x2, y2);
        if (targetId === myClientId) {
            const l = document.createElement('div');
            l.className = 'urge-bubble';
            l.innerHTML = `<span class="from">${fromName}</span>向你投掷了番茄！`;
            document.body.appendChild(l);
            setTimeout(() => l.remove(), 2200);
        }
    }, 800);
}

// Burst splash at a screen position
function splashAt(x, y) {
    const s = document.createElement('div');
    s.textContent = '💥';
    s.style.cssText = `position:fixed;left:${x}px;top:${y}px;font-size:3rem;z-index:1200;transform:translate(-50%,-50%) scale(0.3);pointer-events:none;transition:transform 0.3s ease-out,opacity 0.4s ease-out 0.2s;`;
    document.body.appendChild(s);
    requestAnimationFrame(() => {
        s.style.transform = 'translate(-50%,-50%) scale(1.4)';
        s.style.opacity = '0';
    });
    setTimeout(() => s.remove(), 700);
}

// Fallback center splash (when player tags can't be located)
function showTomato(from) {
    const t = document.createElement('div');
    t.className = 'tomato-splash';
    t.innerHTML = `<span class="tomato">🍅</span><div class="label">${from} 向你投掷了番茄！</div>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
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
    
    const isResult = gameState && gameState.state === 'RESULT_PHASE';
    // Stable color index by original join order (so colors don't reshuffle when ranked)
    const colorIndex = {};
    players.forEach((p, i) => { colorIndex[p.id] = i; });
    
    // Winner banner (result phase only, regular players only)
    const banner = document.getElementById('winner-banner');
    const regulars = players.filter(p => !p.is_spectator);
    if (isResult && regulars.length > 0) {
        const maxScore = Math.max(...regulars.map(p => p.score));
        const winners = regulars.filter(p => p.score === maxScore).map(p => p.name);
        banner.textContent = winners.join('、') + ' 获胜！';
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
    
    // Regular players first (ranked by score in result phase), then a separator, then spectators
    const regs = isResult ? regulars.slice().sort((a, b) => b.score - a.score) : regulars;
    const specsAll = players.filter(p => p.is_spectator);
    const specs = isResult ? specsAll.slice().sort((a, b) => b.score - a.score) : specsAll;

    const appendTag = (p) => {
        const idx = colorIndex[p.id];
        const pColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];
        if (p.id === myClientId && p.is_host) amIHost = true;

        let statusTag = '';
        if (!p.connected) {
            statusTag = '<span style="color:#999;">已离开</span>';
        } else {
            const st = gameState && gameState.state;
            if (st === 'LOBBY' && p.is_ready) statusTag = '<span style="color:#2D7D3F;">准备</span>';
            else if (st === 'HINT_PHASE' && p.has_hints) statusTag = '<span style="color:#2D7D3F;">已提交</span>';
            else if (st === 'GUESS_PHASE' && p.has_guesses) statusTag = '<span style="color:#2D7D3F;">已提交</span>';
        }

        const tag = document.createElement('div');
        tag.className = 'player-tag';
        tag.dataset.pid = p.id;
        tag.style.setProperty('--player-color', pColor);
        if (!p.connected) tag.style.opacity = '0.5';
        if (p.is_host) tag.classList.add('is-host');
        if (p.has_hints || p.has_guesses) tag.classList.add('ready');
        if (p.is_ready) tag.classList.add('is-ready');
        
        tag.innerHTML = `
            <span style="color: ${pColor}; font-weight: bold;">${p.name}</span>
            ${p.is_host ? '<span style="color: var(--ink); border: 1px solid var(--ink); padding: 0 6px; border-radius: 3px; font-size: 0.75rem; margin-left: 6px;">房主</span>' : ''}
            ${p.is_spectator ? '<span style="color: var(--text-light); border: 1px solid var(--text-light); padding: 0 6px; border-radius: 3px; font-size: 0.75rem; margin-left: 6px;">旁观者</span>' : ''}
            <span style="margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--text-light);">
                ${statusTag}
                <span>${p.score}分</span>
            </span>
        `;
        list.appendChild(tag);
    };

    regs.forEach(appendTag);
    if (specs.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'player-list-separator';
        sep.textContent = '旁观者';
        list.appendChild(sep);
        specs.forEach(appendTag);
    }
}

// Build the "猜测 | 正确答案" section (divider + header + each guess vs target's hidden word + center guess)
function buildGuessSection(p, data) {
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
    const isCenterCorrect = p.center_guess === data.center_word;
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
    return `
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
        document.getElementById('player-name').value = myName;
        switchView('login');
    }
});

socket.on('spectator_prompt', (data) => {
    if (confirm('该房间游戏正在进行中，是否以旁观者身份加入？')) {
        socket.emit('join_room', { name: myName, room_code: data.room_code, client_id: myClientId, spectator: true });
    }
});

socket.on('urge', (data) => {
    showUrgeBubble(data.from, data.text);
});

socket.on('throw_tomato', (data) => {
    flyTomato(data.from_id, data.target_id, data.from);
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
        // Clear old guess inputs from previous round
        document.getElementById('guesses-container').innerHTML = '';
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
        const isSpectator = me && me.is_spectator;
        document.getElementById('hint-player-content').style.display = isSpectator ? 'none' : 'block';
        document.getElementById('hint-spectator-msg').style.display = isSpectator ? 'block' : 'none';
        if (!isSpectator && me && me.has_hints) {
            document.getElementById('btn-submit-hints').style.display = 'none';
            document.getElementById('hint-wait-msg').style.display = 'block';
            document.getElementById('hint1-input').disabled = true;
            document.getElementById('hint2-input').disabled = true;
        }
        // Fun buttons while waiting (submitted, or spectating with nothing to do)
        document.getElementById('hint-actions').style.display =
            (me && (me.has_hints || isSpectator)) ? 'flex' : 'none';
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

        // Show own hints and hidden word first (spectators have no hidden word)
        if (me && !me.is_spectator) {
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
            if (p.id === myClientId || p.is_spectator) return; // Only guess regular players, not self/spectators
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
        // Fun buttons while waiting for others to submit
        document.getElementById('guess-actions').style.display = (me && me.has_guesses) ? 'flex' : 'none';
    }
    
    // RESULT PHASE
    if (data.state === 'RESULT_PHASE') {
        document.getElementById('result-center-word').innerText = data.center_word;
        
        const container = document.getElementById('result-container');
        container.innerHTML = '';
        
        data.players.forEach((p, idx) => {
            if (p.is_spectator) return; // spectators shown in a separate section below
            const pColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];

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
                ${buildGuessSection(p, data)}
            `;
            container.appendChild(div);
        });

        // Spectator ranking (separate section, sorted by score, full guess details like players)
        const spectators = data.players.filter(p => p.is_spectator).sort((a, b) => b.score - a.score);
        if (spectators.length > 0) {
            const heading = document.createElement('div');
            heading.style.cssText = 'text-align:center; font-family:"Ma Shan Zheng",cursive; font-size:1.6rem; color:var(--text-light); margin:1.5rem 0 0.5rem;';
            heading.textContent = '旁观者排名';
            container.appendChild(heading);

            spectators.forEach((sp, i) => {
                const div = document.createElement('div');
                div.className = 'result-item';
                div.style.setProperty('border-left', '4px solid var(--text-light)');
                div.innerHTML = `
                    <div class="result-player-name" style="color: var(--text-light); font-size: 1.2rem; font-weight: bold; margin-bottom: 12px;">
                        ${i + 1}. ${sp.name}（旁观者）<span class="score">${sp.score}分</span>
                    </div>
                    ${buildGuessSection(sp, data)}
                `;
                container.appendChild(div);
            });
        }
        
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

document.getElementById('btn-exit-room').addEventListener('click', () => {
    socket.emit('exit_room');
    sessionStorage.removeItem('caizijiedi_session');
    currentRoom = '';
    pendingRoom = '';
    gameState = null;
    myHiddenWord = '';
    myGuesses = {};
    myCenterGuess = '';
    hideMessage();
    document.getElementById('player-name').value = myName;
    switchView('login');
});

// 催促按钮（出题/猜测阶段等待时出现，5 秒冷却）
document.querySelectorAll('.btn-urge').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const text = URGE_TEXTS[Math.floor(Math.random() * URGE_TEXTS.length)];
        socket.emit('urge', { text });
        btn.disabled = true;
        let n = 5;
        btn.textContent = `催促 (${n}s)`;
        const tick = setInterval(() => {
            n--;
            if (n <= 0) {
                clearInterval(tick);
                btn.disabled = false;
                btn.textContent = '催促';
            } else {
                btn.textContent = `催促 (${n}s)`;
            }
        }, 1000);
    });
});

// 投掷番茄按钮 → 弹出目标选择
document.querySelectorAll('.btn-throw').forEach(btn => {
    btn.addEventListener('click', () => {
        const box = document.getElementById('throw-targets');
        box.innerHTML = '';
        const players = (gameState && gameState.players) || [];
        // Only allow throwing at connected, non-self players
        const targets = players.filter(p => p.connected && p.id !== myClientId);
        if (targets.length === 0) {
            box.innerHTML = '<p style="color: var(--text-light);">没有可投掷的玩家</p>';
        } else {
            targets.forEach(p => {
                const b = document.createElement('button');
                b.className = 'btn-secondary';
                b.textContent = p.name + (p.is_spectator ? '（旁观者）' : '');
                b.style.width = '100%';
                b.addEventListener('click', () => {
                    socket.emit('throw_tomato', { target_id: p.id });
                    document.getElementById('throw-modal').style.display = 'none';
                });
                box.appendChild(b);
            });
        }
        document.getElementById('throw-modal').style.display = 'flex';
    });
});

document.getElementById('btn-throw-cancel').addEventListener('click', () => {
    document.getElementById('throw-modal').style.display = 'none';
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
