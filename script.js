/* =====================================================
   AETHER — script.js
   Frontend logic: chat, goals, memory, check-in
   ===================================================== */

// ── State ─────────────────────────────────────────────
// All data is stored in localStorage so it persists between sessions
let state = loadState();

// Conversation history sent to AI (keeps context between messages)
let conversationHistory = [];

/* ── loadState / saveState ─────────────────────────────
   Persists everything in localStorage as JSON.
   Default values are set if nothing is stored yet.
*/
function loadState() {
  const saved = localStorage.getItem('aether_state');
  if (saved) return JSON.parse(saved);
  // First-time defaults
  return {
    memory: {},            // Key-value facts about the user (name, goals, etc.)
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
// Runs when page loads
document.addEventListener('DOMContentLoaded', () => {
  resetDailyIfNeeded();  // Reset daily check-in if it's a new day
  renderGoals();
  renderStats();
  renderMemory();
  updateCheckinPanel();
});

/* ── Daily Reset ───────────────────────────────────────
   Each new calendar day, goals reset to "not done today"
   and check-in resets.
*/
function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (state.lastCheckinDate !== today) {
    // New day — reset all "todayDone" flags
    state.goals.forEach(g => g.todayDone = false);
    state.checkinDone = false;
    state.lastCheckinDate = today;
    saveState();
  }
}

// ── Sidebar Toggle ─────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── Chat Functions ─────────────────────────────────────

/* handleKey: send on Enter (but allow Shift+Enter for newline) */
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

/* autoResize: grow textarea as user types */
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* sendMessage: main function that handles user input */
async function sendMessage() {
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;

  // Render user message
  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';

  // Disable send button while waiting
  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;

  // Show typing indicator
  showTyping(true);

  try {
    // Build the AI prompt with user context
    const systemPrompt = buildSystemPrompt();

    // Add user message to conversation history
    conversationHistory.push({ role: 'user', content: text });

    // Extract any facts from user message (e.g., "my name is Sushant")
    extractMemory(text);

    // Call our backend API
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conversationHistory,
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Server error');
    }

    const data = await response.json();
    const aiReply = data.reply;

    // Add AI reply to history so it has context next time
    conversationHistory.push({ role: 'assistant', content: aiReply });

    // Show reply
    showTyping(false);
    appendMessage('ai', aiReply);

    // Check if the AI reply contains goal updates
    handleGoalKeywords(text);

  } catch (err) {
    showTyping(false);
    appendMessage('ai', `⚠️ Error: ${err.message}. Make sure the server is running and your API key is set.`);
  }

  sendBtn.disabled = false;
  renderMemory();
}

/* appendMessage: creates and inserts a chat bubble */
function appendMessage(role, text) {
  const messages = document.getElementById('messages');

  const msg = document.createElement('div');
  msg.classList.add('msg', role);

  const avatar = document.createElement('div');
  avatar.classList.add('msg-avatar');
  // "A" for Aether, "U" for User
  avatar.textContent = role === 'ai' ? 'A' : 'U';

  const content = document.createElement('div');
  content.classList.add('msg-content');

  // Split on double newlines to make paragraphs
  const paragraphs = text.split(/\n\n+/);
  paragraphs.forEach(p => {
    const para = document.createElement('p');
    // Single newlines become <br>
    para.innerHTML = p.replace(/\n/g, '<br>');
    content.appendChild(para);
  });

  msg.appendChild(avatar);
  msg.appendChild(content);
  messages.appendChild(msg);

  // Scroll to bottom
  messages.scrollTop = messages.scrollHeight;
}

/* showTyping: show/hide the "..." typing indicator */
function showTyping(show) {
  document.getElementById('typing').style.display = show ? 'flex' : 'none';
  if (show) {
    const messages = document.getElementById('messages');
    messages.scrollTop = messages.scrollHeight;
  }
}

/* clearChat: wipe the message history */
function clearChat() {
  if (!confirm('Clear chat history?')) return;
  conversationHistory = [];
  const messages = document.getElementById('messages');
  messages.innerHTML = '';
  appendMessage('ai', "Chat cleared. What do you want to work on today?");
}

// ── System Prompt Builder ──────────────────────────────
/* Builds the AI's personality + user context */
function buildSystemPrompt() {
  // Format known memory facts
  const memoryLines = Object.entries(state.memory)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || 'Nothing stored yet.';

  // Format goals
  const goalLines = state.goals
    .map(g => `- ${g.name}: ${g.target} (streak: ${g.streak} days, today: ${g.todayDone ? '✓ done' : '✗ not done'})`)
    .join('\n') || 'No goals set.';

  return `You are Aether, a disciplined personal AI mentor. Your personality:
- Blunt, direct, no sugarcoating. Tell the truth even if it's uncomfortable.
- Short responses (2-4 sentences max unless explaining something complex).
- Motivating but demanding — hold the user to their commitments.
- Never say "great job" for mediocre effort. Call it out.
- Remember everything the user tells you and reference it naturally.

USER MEMORY (known facts about this user):
${memoryLines}

USER GOALS (current active goals):
${goalLines}

TODAY'S DATE: ${new Date().toDateString()}

Instructions:
- If the user tells you their name, remember it and use it.
- If they report completing a goal, acknowledge it briefly and push them to the next one.
- If they make excuses, call it out directly.
- Keep responses concise. No fluff.
- When relevant, reference their specific goals (boxing, coding, English, etc.).`;
}

// ── Memory Extraction ──────────────────────────────────
/* Simple pattern matching to pull facts from user messages.
   e.g., "my name is Sushant" → memory.name = "Sushant"
*/
function extractMemory(text) {
  const lower = text.toLowerCase();

  // Name
  const nameMatch = text.match(/my name is ([A-Za-z]+)/i);
  if (nameMatch) state.memory.name = nameMatch[1];

  // Age
  const ageMatch = text.match(/i(?:'m| am) (\d+)(?: years? old)?/i);
  if (ageMatch) state.memory.age = ageMatch[1];

  // Location
  const locMatch = text.match(/(?:i live in|i'm from|from) ([A-Za-z\s]+)/i);
  if (locMatch) state.memory.location = locMatch[1].trim();

  // Wake up time
  const wakeMatch = text.match(/wake up at ([0-9:apm\s]+)/i);
  if (wakeMatch) state.memory.wakeTime = wakeMatch[1].trim();

  // Sleep time
  const sleepMatch = text.match(/sleep at ([0-9:apm\s]+)/i);
  if (sleepMatch) state.memory.sleepTime = sleepMatch[1].trim();

  // Save updated memory
  saveState();
}

/* clearMemory: wipe stored user facts */
function clearMemory() {
  if (!confirm('Clear all stored memory?')) return;
  state.memory = {};
  saveState();
  renderMemory();
}

/* renderMemory: show stored facts in sidebar */
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

// ── Goal Detection ─────────────────────────────────────
/* Detect when user says they completed a goal */
function handleGoalKeywords(text) {
  const lower = text.toLowerCase();
  const doneWords = ['done', 'finished', 'completed', 'did', 'trained', 'practiced', 'worked'];
  const isDone = doneWords.some(w => lower.includes(w));

  state.goals.forEach(goal => {
    if (lower.includes(goal.name.toLowerCase()) && isDone) {
      markGoalDone(goal.id, false); // false = silent (no re-render message)
    }
  });
}

// ── Goal CRUD ─────────────────────────────────────────

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
  if (!name) return alert('Please enter a goal name.');

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
}

function markGoalDone(id, rerender = true) {
  const goal = state.goals.find(g => g.id === id);
  if (!goal) return;

  if (!goal.todayDone) {
    goal.todayDone = true;
    goal.streak += 1;
    state.stats.completed += 1;
    saveState();
    if (rerender) {
      renderGoals();
      renderStats();
    }
  }
}

/* renderGoals: draw goal list in sidebar */
function renderGoals() {
  const list = document.getElementById('goal-list');
  list.innerHTML = '';

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

/* renderStats: draw weekly stats in sidebar */
function renderStats() {
  const grid = document.getElementById('stats-grid');
  const totalGoals = state.goals.length;
  const doneToday = state.goals.filter(g => g.todayDone).length;
  const completionRate = totalGoals > 0
    ? Math.round((doneToday / totalGoals) * 100) : 0;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-num" style="color:var(--green)">${doneToday}</div>
      <div class="stat-label">DONE TODAY</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--accent)">${state.stats.completed}</div>
      <div class="stat-label">TOTAL DONE</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--amber)">${completionRate}%</div>
      <div class="stat-label">TODAY RATE</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--red)">${state.stats.missed}</div>
      <div class="stat-label">MISSED</div>
    </div>
  `;
}

// ── Daily Check-in ────────────────────────────────────
function updateCheckinPanel() {
  const dot = document.getElementById('checkin-status');
  const dateEl = document.getElementById('checkin-date');
  const btn = document.getElementById('btn-checkin');

  dateEl.textContent = new Date().toDateString();

  if (state.checkinDone) {
    dot.classList.add('done');
    btn.textContent = 'Check-in Complete ✓';
    btn.style.opacity = '0.6';
    btn.style.cursor = 'default';
  } else {
    dot.classList.add('pending');
    btn.textContent = 'Start Today\'s Check-In';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

/* startCheckIn: sends a check-in message to the AI */
function startCheckIn() {
  if (state.checkinDone) return; // Already done today

  state.checkinDone = true;
  saveState();
  updateCheckinPanel();

  // Build check-in prompt based on goals
  const goalNames = state.goals.map(g => g.name).join(', ');
  const name = state.memory.name ? state.memory.name : 'you';

  const checkinText = `Daily check-in. Goals: ${goalNames}. How am I doing?`;

  // Pre-fill input and send
  document.getElementById('user-input').value = checkinText;
  sendMessage();
}
