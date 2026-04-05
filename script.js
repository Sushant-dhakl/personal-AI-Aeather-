/* =====================================================
   AETHER — script.js
   Frontend logic: chat, goals, memory, check-in
   ===================================================== */

// ── State ─────────────────────────────────────────────
let state = loadState();
let conversationHistory = [];

function loadState() {
  const saved = localStorage.getItem('aether_state');
  if (saved) {
    try { return JSON.parse(saved); } catch(e) { /* corrupt data, reset */ }
  }
  return {
    memory: {},
    goals: [
      { id: 1, name: 'Boxing',  target: '1 hour training', streak: 0, todayDone: false },
      { id: 2, name: 'English', target: '30 min practice',  streak: 0, todayDone: false },
      { id: 3, name: 'Coding',  target: '1 hour project',   streak: 0, todayDone: false },
    ],
    checkinDone: false,
    lastCheckinDate: null,
    stats: { completed: 0, missed: 0, streak: 0 },
    nextGoalId: 4,
  };
}

function saveState() {
  localStorage.setItem('aether_state', JSON.stringify(state));
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  resetDailyIfNeeded();
  renderGoals();
  renderStats();
  renderMemory();
  updateCheckinPanel();
});

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (state.lastCheckinDate !== today) {
    state.goals.forEach(g => g.todayDone = false);
    state.checkinDone = false;
    state.lastCheckinDate = today;
    saveState();
  }
}

// ── Sidebar ───────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── Chat ──────────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

async function sendMessage() {
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';

  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;
  showTyping(true);

  // Extract memory BEFORE building prompt so it's included
  extractMemory(text);
  const systemPrompt = buildSystemPrompt();
  conversationHistory.push({ role: 'user', content: text });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conversationHistory,
        system: systemPrompt,
      }),
    });

    // FIX: handle both string and object error shapes from OpenRouter
    if (!response.ok) {
      const err = await response.json();
      const msg = (typeof err.error === 'object')
        ? err.error?.message
        : err.error;
      throw new Error(msg || `Server error ${response.status}`);
    }

    const data = await response.json();

    // FIX: guard against empty/null reply from AI
    const aiReply = (data.reply && data.reply.trim())
      ? data.reply
      : "...";

    conversationHistory.push({ role: 'assistant', content: aiReply });

    showTyping(false);
    appendMessage('ai', aiReply);

    // FIX: re-render goals+stats after keyword detection
    handleGoalKeywords(text);
    renderGoals();
    renderStats();

  } catch (err) {
    showTyping(false);
    appendMessage('ai', `⚠️ ${err.message}`);
  }

  sendBtn.disabled = false;
  renderMemory();
}

function appendMessage(role, text) {
  const messages = document.getElementById('messages');

  // FIX: guard against null/undefined text crashing .split()
  const safeText = (text && typeof text === 'string') ? text : '...';

  const msg = document.createElement('div');
  msg.classList.add('msg', role);

  const avatar = document.createElement('div');
  avatar.classList.add('msg-avatar');
  avatar.textContent = role === 'ai' ? 'A' : 'U';

  const content = document.createElement('div');
  content.classList.add('msg-content');

  safeText.split(/\n\n+/).forEach(p => {
    const para = document.createElement('p');
    para.innerHTML = p.replace(/\n/g, '<br>');
    content.appendChild(para);
  });

  msg.appendChild(avatar);
  msg.appendChild(content);
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping(show) {
  document.getElementById('typing').style.display = show ? 'flex' : 'none';
  if (show) {
    document.getElementById('messages').scrollTop = 999999;
  }
}

function clearChat() {
  if (!confirm('Clear chat history?')) return;
  conversationHistory = [];
  document.getElementById('messages').innerHTML = '';
  appendMessage('ai', "Chat cleared. What do you want to work on today?");
}

// ── System Prompt ─────────────────────────────────────
function buildSystemPrompt() {
  const memoryLines = Object.entries(state.memory)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || 'Nothing stored yet.';

  const goalLines = state.goals
    .map(g => `- ${g.name}: ${g.target} (streak: ${g.streak} days, today: ${g.todayDone ? 'DONE' : 'NOT DONE'})`)
    .join('\n') || 'No goals set.';

  return `You are Aether, a disciplined personal AI mentor. Your personality:
- Blunt, direct, no sugarcoating. Tell the truth even if it's uncomfortable.
- Short responses (2-4 sentences max unless explaining something complex).
- Motivating but demanding — hold the user to their commitments.
- Never praise mediocre effort. Call it out.
- No filler words. No "Great question!". Get to the point.

USER MEMORY:
${memoryLines}

USER GOALS:
${goalLines}

TODAY: ${new Date().toDateString()}

Rules:
- Use the user's name if you know it.
- If they completed a goal, acknowledge briefly and push to the next one.
- If they make excuses, call it out directly.
- Reference their specific goals when relevant (boxing, coding, English).`;
}

// ── Memory ────────────────────────────────────────────
function extractMemory(text) {
  // FIX: removed unused `lower` variable

  const nameMatch = text.match(/my name is ([A-Za-z]+)/i);
  if (nameMatch) state.memory.name = nameMatch[1];

  const ageMatch = text.match(/i(?:'m| am) (\d+)(?: years? old)?/i);
  if (ageMatch) state.memory.age = ageMatch[1];

  const locMatch = text.match(/(?:i live in|i'm from|i am from) ([A-Za-z ,]+?)(?:\.|$)/i);
  if (locMatch) state.memory.location = locMatch[1].trim();

  const wakeMatch = text.match(/wake up at ([0-9:apmAP ]+)/i);
  if (wakeMatch) state.memory.wakeTime = wakeMatch[1].trim();

  const sleepMatch = text.match(/(?:sleep|go to bed) at ([0-9:apmAP ]+)/i);
  if (sleepMatch) state.memory.sleepTime = sleepMatch[1].trim();

  saveState();
}

function clearMemory() {
  if (!confirm('Clear all stored memory?')) return;
  state.memory = {};
  saveState();
  renderMemory();
}

function renderMemory() {
  const el = document.getElementById('memory-info');
  const entries = Object.entries(state.memory);
  if (entries.length === 0) {
    el.textContent = 'No details stored yet.';
    return;
  }
  el.innerHTML = entries
    .map(([k, v]) => `<span style="color:var(--text-3)">${k}:</span> ${v}`)
    .join('<br>');
}

// ── Goals ─────────────────────────────────────────────
function handleGoalKeywords(text) {
  const lower = text.toLowerCase();
  const doneWords = ['done', 'finished', 'completed', 'did', 'trained', 'practiced', 'worked', 'studied'];
  const isDone = doneWords.some(w => lower.includes(w));

  if (!isDone) return;

  state.goals.forEach(goal => {
    if (lower.includes(goal.name.toLowerCase()) && !goal.todayDone) {
      goal.todayDone = true;
      goal.streak += 1;
      state.stats.completed += 1;
    }
  });
  saveState();
  // FIX: caller now re-renders after this, so no need to do it here
}

function openAddGoal() {
  document.getElementById('modal-overlay').style.display = 'block';
  document.getElementById('goal-modal').style.display = 'block';
  document.getElementById('goal-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('goal-modal').style.display = 'none';
  document.getElementById('goal-name').value = '';
  document.getElementById('goal-target').value = '';
}

function addGoal() {
  const name = document.getElementById('goal-name').value.trim();
  const target = document.getElementById('goal-target').value.trim();
  if (!name) { alert('Please enter a goal name.'); return; }

  state.goals.push({
    id: state.nextGoalId++,
    name,
    target: target || 'Daily practice',
    streak: 0,
    todayDone: false,
  });
  saveState();
  closeModal();
  renderGoals();
  renderStats();
}

function markGoalDone(id) {
  const goal = state.goals.find(g => g.id === id);
  if (!goal || goal.todayDone) return;

  goal.todayDone = true;
  goal.streak += 1;
  state.stats.completed += 1;
  saveState();
  renderGoals();
  renderStats();
}

function renderGoals() {
  const list = document.getElementById('goal-list');
  list.innerHTML = '';

  if (state.goals.length === 0) {
    list.innerHTML = '<li style="color:var(--text-3);font-size:12px;font-family:var(--font-mono)">No goals yet. Add one above.</li>';
    return;
  }

  state.goals.forEach(goal => {
    const li = document.createElement('li');
    li.classList.add('goal-item');
    li.innerHTML = `
      <div class="goal-checkbox ${goal.todayDone ? 'checked' : ''}"
           onclick="markGoalDone(${goal.id})" title="Mark done"></div>
      <div class="goal-text">
        <div class="goal-name">${goal.name}</div>
        <div class="goal-target">${goal.target}</div>
        ${goal.streak > 0 ? `<div class="goal-streak">🔥 ${goal.streak} day streak</div>` : ''}
      </div>
    `;
    list.appendChild(li);
  });
}

function renderStats() {
  const grid = document.getElementById('stats-grid');
  const total = state.goals.length;
  const done = state.goals.filter(g => g.todayDone).length;
  const rate = total > 0 ? Math.round((done / total) * 100) : 0;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-num" style="color:var(--green)">${done}</div>
      <div class="stat-label">DONE TODAY</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--accent)">${state.stats.completed}</div>
      <div class="stat-label">ALL TIME</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--amber)">${rate}%</div>
      <div class="stat-label">TODAY RATE</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--red)">${state.stats.missed}</div>
      <div class="stat-label">MISSED</div>
    </div>
  `;
}

// ── Check-in ──────────────────────────────────────────
function updateCheckinPanel() {
  const dot = document.getElementById('checkin-status');
  const dateEl = document.getElementById('checkin-date');
  const btn = document.getElementById('btn-checkin');

  dateEl.textContent = new Date().toDateString();

  if (state.checkinDone) {
    dot.classList.remove('pending');
    dot.classList.add('done');
    btn.textContent = 'Check-in Complete ✓';
    btn.style.opacity = '0.6';
    btn.style.cursor = 'default';
  } else {
    dot.classList.remove('done');
    dot.classList.add('pending');
    btn.textContent = "Start Today's Check-In";
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

function startCheckIn() {
  if (state.checkinDone) return;

  state.checkinDone = true;
  saveState();
  updateCheckinPanel();

  const goalNames = state.goals.map(g => g.name).join(', ');
  const checkinText = `Daily check-in. My goals: ${goalNames}. Hold me accountable.`;

  // FIX: set value directly then call sendMessage — no async timing issue
  const input = document.getElementById('user-input');
  input.value = checkinText;
  // Small delay to ensure value is committed before sendMessage reads it
  setTimeout(() => sendMessage(), 0);
}
