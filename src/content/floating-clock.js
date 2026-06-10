/**
 * FocusTube — Floating Pomodoro Clock
 * A draggable countdown widget that can float over any page when the user
 * enables it in settings. Mirrors the standalone Pomodoro timer managed by
 * the background service worker. Self-contained (content scripts can't import).
 */

(() => {
  'use strict';

  // Guard against double-injection (declarative content script + programmatic
  // injection from the background when the user enables the clock).
  if (window.__focusTubeFloatingClock) return;
  window.__focusTubeFloatingClock = true;

  const CLOCK_ID = 'focustube-floating-clock';

  const MSG = {
    POMODORO_GET: 'POMODORO_GET',
    POMODORO_START: 'POMODORO_START',
    POMODORO_PAUSE: 'POMODORO_PAUSE',
    POMODORO_SKIP: 'POMODORO_SKIP',
    POMODORO_RESET: 'POMODORO_RESET',
    POMODORO_UPDATED: 'POMODORO_UPDATED',
  };

  const PHASE_LABEL = {
    focus: 'Focus',
    shortBreak: 'Short Break',
    longBreak: 'Long Break',
  };

  let settings = {};
  let pomodoro = null;
  let tickInterval = null;
  let root = null;

  // ─── Boot ──────────────────────────────────────────────────────────

  async function init() {
    await loadSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      settings = changes.settings.newValue || {};
      sync();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MSG.POMODORO_UPDATED) {
        pomodoro = sanitizePomodoro(message.data);
        render();
      }
    });

    sync();
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get('settings');
      settings = stored.settings || {};
    } catch {
      settings = {};
    }
  }

  // Show or hide the widget based on the feature toggle.
  async function sync() {
    if (settings.floatingClockEnabled) {
      if (!root) mount();
      applyPosition();
      pomodoro = sanitizePomodoro(await sendMessage({ type: MSG.POMODORO_GET }));
      render();
    } else {
      unmount();
    }
  }

  // Reject malformed responses so the display falls back to a fresh idle timer.
  function sanitizePomodoro(state) {
    const valid = state && ['idle', 'running', 'paused'].includes(state.status);
    return valid ? state : null;
  }

  // ─── Mount / Unmount ───────────────────────────────────────────────

  function mount() {
    root = document.createElement('div');
    root.id = CLOCK_ID;
    root.className = 'ft-clock';
    root.innerHTML = `
      <div class="ft-clock__drag" data-role="drag">
        <span class="ft-clock__dot"></span>
        <span class="ft-clock__phase" data-role="phase">Focus</span>
        <button class="ft-clock__hide" data-act="hide" title="Hide clock">×</button>
      </div>
      <div class="ft-clock__time" data-role="time">25:00</div>
      <div class="ft-clock__cycle" data-role="cycle"></div>
      <div class="ft-clock__controls">
        <button class="ft-clock__btn" data-act="toggle" data-role="toggle" title="Start / Pause">▶</button>
        <button class="ft-clock__btn" data-act="skip" title="Skip phase">⏭</button>
        <button class="ft-clock__btn" data-act="reset" title="Reset">⟲</button>
      </div>
    `;
    (document.body || document.documentElement).appendChild(root);

    root.addEventListener('click', onClick);
    setupDragging(root.querySelector('[data-role="drag"]'));

    if (!tickInterval) tickInterval = setInterval(render, 1000);
  }

  function unmount() {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    if (root) { root.remove(); root = null; }
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  function render() {
    if (!root) return;

    const phase = pomodoro?.phase || 'focus';
    const status = pomodoro?.status || 'idle';
    const isBreak = phase !== 'focus';

    root.classList.toggle('ft-clock--break', isBreak);
    root.classList.toggle('ft-clock--running', status === 'running');

    root.querySelector('[data-role="phase"]').textContent = PHASE_LABEL[phase] || 'Focus';
    root.querySelector('[data-role="time"]').textContent = formatTime(remainingMs());

    const toggleBtn = root.querySelector('[data-role="toggle"]');
    toggleBtn.textContent = status === 'running' ? '⏸' : '▶';

    const cycleEl = root.querySelector('[data-role="cycle"]');
    const done = pomodoro?.completedFocus || 0;
    cycleEl.textContent = done > 0 ? `${done} focus ${done === 1 ? 'session' : 'sessions'} done` : '';
  }

  // Milliseconds left in the current phase given the current status.
  function remainingMs() {
    if (!pomodoro || pomodoro.status === 'idle') {
      const mins = Number(settings.pomodoroFocusMinutes) || 25;
      return mins * 60000;
    }
    if (pomodoro.status === 'paused') return Math.max(0, pomodoro.remainingMs || 0);
    return Math.max(0, (pomodoro.phaseEndTime || Date.now()) - Date.now());
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ─── Interaction ───────────────────────────────────────────────────

  async function onClick(e) {
    const act = e.target?.dataset?.act;
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();

    if (act === 'hide') {
      await saveSettings({ floatingClockEnabled: false });
      return;
    }
    if (act === 'toggle') {
      const running = pomodoro?.status === 'running';
      pomodoro = sanitizePomodoro(await sendMessage({ type: running ? MSG.POMODORO_PAUSE : MSG.POMODORO_START }));
    } else if (act === 'skip') {
      pomodoro = sanitizePomodoro(await sendMessage({ type: MSG.POMODORO_SKIP }));
    } else if (act === 'reset') {
      pomodoro = sanitizePomodoro(await sendMessage({ type: MSG.POMODORO_RESET }));
    }
    render();
  }

  // ─── Dragging ──────────────────────────────────────────────────────

  function applyPosition() {
    if (!root) return;
    const pos = settings.floatingClockPosition || { right: 24, bottom: 24 };
    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
      root.style.left = pos.left + 'px';
      root.style.top = pos.top + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    } else {
      root.style.right = (pos.right ?? 24) + 'px';
      root.style.bottom = (pos.bottom ?? 24) + 'px';
      root.style.left = 'auto';
      root.style.top = 'auto';
    }
  }

  function setupDragging(handle) {
    if (!handle) return;
    let startX, startY, originLeft, originTop, dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.dataset.act === 'hide') return; // don't drag when closing
      dragging = true;
      const rect = root.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      root.classList.add('ft-clock--dragging');
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = clamp(originLeft + (e.clientX - startX), 0, window.innerWidth - root.offsetWidth);
      const top = clamp(originTop + (e.clientY - startY), 0, window.innerHeight - root.offsetHeight);
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    });

    const end = async (e) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('ft-clock--dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      const rect = root.getBoundingClientRect();
      await saveSettings({ floatingClockPosition: { left: Math.round(rect.left), top: Math.round(rect.top) } });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  async function saveSettings(patch) {
    const stored = await chrome.storage.local.get('settings');
    const merged = { ...(stored.settings || {}), ...patch };
    await chrome.storage.local.set({ settings: merged });
    // storage.onChanged will fire and call sync().
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError; // swallow "no receiver" noise
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // ─── Start ─────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
