// public/js/chat.js
import { aiApi } from './api.js';
import { showToast, formatChatText, esc } from './ui.js';

const SUGGESTIONS = [
  'Recommend movies like Interstellar',
  'Best underrated sci-fi movies',
  'Movies with mind-bending twist endings',
  'Classic films I should watch before I die',
  'Best Indian movies of the last decade',
  'Comfort movies for a rainy day',
  'Movies like The Dark Knight',
  'Psychological thrillers with no jump scares',
];

const WELCOME = `Hey! I'm CineMind AI 🎬 — your personal movie guide.

Ask me anything: *"Recommend movies like Parasite"*, *"I want a thriller with a twist ending"*, or *"What should I watch tonight?"*

I know films from every era, genre, and country. What are you in the mood for?`;

const MAX_HISTORY = 20; // messages sent to the server (server allows 40)

export function initChat(sectionEl) {
  const messagesEl = sectionEl.querySelector('#chat-messages');
  const input = sectionEl.querySelector('#chat-input');
  const sendBtn = sectionEl.querySelector('#chat-send');
  const suggestionsEl = sectionEl.querySelector('#chat-suggestions');
  const clearBtn = sectionEl.querySelector('#chat-clear');
  if (!messagesEl || !input || !sendBtn) return;

  let messages = []; // what the model sees (excludes the welcome bubble)
  let isLoading = false;

  if (suggestionsEl) {
    suggestionsEl.innerHTML = SUGGESTIONS.map((s) =>
      `<button type="button" class="chat-suggestion">${esc(s)}</button>`).join('');
    suggestionsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chat-suggestion');
      if (!btn) return;
      input.value = btn.textContent;
      sendMessage();
    });
  }

  function reset() {
    messages = [];
    messagesEl.innerHTML = '';
    addMessage('assistant', WELCOME);
    suggestionsEl?.classList.remove('hidden');
  }

  function addMessage(role, content) {
    const el = document.createElement('div');
    el.className = `chat-message ${role} animate-slide-up`;
    el.innerHTML = `
      <div class="chat-avatar">${role === 'assistant' ? '🎬' : '👤'}</div>
      <div class="chat-bubble">${formatChatText(content)}</div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'chat-message assistant';
    el.innerHTML = `
      <div class="chat-avatar">🎬</div>
      <div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  async function sendMessage() {
    const text = input.value.trim().slice(0, 1000);
    if (!text || isLoading) return;

    isLoading = true;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    suggestionsEl?.classList.add('hidden');

    addMessage('user', text);
    messages.push({ role: 'user', content: text });
    const typing = addTyping();

    try {
      // Trim *before* sending so the server limit can never be exceeded
      const outgoing = messages.slice(-MAX_HISTORY);
      const data = await aiApi.chat(outgoing);
      typing.remove();
      addMessage('assistant', data.reply);
      messages.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      typing.remove();
      // Drop the unanswered question so history keeps alternating user/assistant
      messages.pop();
      addMessage('assistant', `Sorry, I ran into an issue — ${err.message} Please try again.`);
      showToast(`Chat error: ${err.message}`, 'error');
      input.value = text; // let them resend with one click
    } finally {
      isLoading = false;
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  clearBtn?.addEventListener('click', () => { if (!isLoading) reset(); });

  reset();
}
