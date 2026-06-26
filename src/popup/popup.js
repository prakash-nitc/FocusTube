/**
 * FocusTube — Popup Logic
 * Manages popup state, session controls, timers, and stats display.
 */

(() => {
  'use strict';

  // ─── DOM Elements ──────────────────────────────────────────────────

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    popup: $('#popup'),
    statusBar: $('#popup-status'),
    statusDot: $('#popup-status-dot'),
    statusText: $('#popup-status-text'),

    // States
    stateIdle: $('#state-idle'),
    stateActive: $('#state-active'),

    // Idle
    goalInput: $('#goal-input'),
    startBtn: $('#start-session-btn'),
    startHint: $('#start-hint'),
    todayStudy: $('#today-study'),
    todayScore: $('#today-score'),
    todayDistractions: $('#today-distractions'),

    // Active
    sessionTitle: $('#session-title'),
    sessionGoalWrapper: $('#session-goal-wrapper'),
    sessionGoal: $('#session-goal'),
    sessionTimer: $('#session-timer'),
    timerLabel: $('#timer-label'),
    liveFocusScore: $('#live-focus-score'),
    liveDistractions: $('#live-distractions'),
    liveRecovered: $('#live-recovered'),

    // Break
    breakInfo: $('#break-info'),
    breakTimer: $('#break-timer'),
    takeBreakBtn: $('#take-break-btn'),
    endBreakBtn: $('#end-break-btn'),
    breakPicker: $('#break-picker'),
    sessionActions: $('.popup__session-actions'),

    // Session controls
    endSessionBtn: $('#end-session-btn'),
    emergencyBtn: $('#emergency-btn'),

    // Footer
    dashboardBtn: $('#open-dashboard-btn'),
    optionsBtn: $('#open-options-btn'),

    // Pomodoro
    pomoCard: $('#pomodoro-card'),
    pomoDot: $('#pomo-dot'),
    pomoPhase: $('#pomo-phase'),
    pomoCycle: $('#pomo-cycle'),
    pomoTime: $('#pomo-time'),
    pomoToggle: $('#pomo-toggle'),
    pomoSkip: $('#pomo-skip'),
    pomoReset: $('#pomo-reset'),
    pomoClockToggle: $('#pomo-clock-toggle'),
  };

  let timerInterval = null;
  let breakTimerInterval = null;
  let currentSession = null;
  let settings = null;
  let pomodoroState = null;
  let pomodoroInterval = null;

  // ─── Initialization ───────────────────────────────────────────────

  async function init() {
    await loadSettings();
    renderBreakOptions();
    bindEvents();
    bindPomodoro();

    // Keep the Pomodoro display in sync if it changes elsewhere.
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'POMODORO_UPDATED') {
        pomodoroState = sanitizePomodoro(message.data);
        renderPomodoro();
      }
    });
    pomodoroInterval = setInterval(renderPomodoro, 1000);

    await Promise.all([refreshState(), loadPomodoro()]);
  }

  async function loadSettings() {
    try {
      const { settings: stored } = await chrome.storage.local.get('settings');
      settings = stored || {};
    } catch {
      settings = {};
    }
  }

  // ─── Pomodoro Timer ────────────────────────────────────────────────

  function bindPomodoro() {
    els.pomoToggle.addEventListener('click', () => {
      const running = pomodoroState?.status === 'running';
      pomodoroCommand(running ? 'POMODORO_PAUSE' : 'POMODORO_START');
    });
    els.pomoSkip.addEventListener('click', () => pomodoroCommand('POMODORO_SKIP'));
    els.pomoReset.addEventListener('click', () => pomodoroCommand('POMODORO_RESET'));

    // Floating clock toggle — saving the setting mounts/unmounts the widget
    // live on every open tab via each content script's storage.onChanged.
    els.pomoClockToggle.checked = !!settings?.floatingClockEnabled;
    els.pomoClockToggle.addEventListener('change', async () => {
      const { settings: existing } = await chrome.storage.local.get('settings');
      const merged = { ...(existing || {}), floatingClockEnabled: els.pomoClockToggle.checked };
      await chrome.storage.local.set({ settings: merged });
      settings = merged;
    });
  }

  async function pomodoroCommand(type) {
    try {
      pomodoroState = sanitizePomodoro(await sendMessage({ type }));
    } catch (e) {
      // Background unreachable — keep the last known state.
    }
    renderPomodoro();
  }

  async function loadPomodoro() {
    await pomodoroCommand('POMODORO_GET');
  }

  // Reject malformed responses (e.g. an {error} object from an outdated
  // background script) so the display falls back to a fresh idle timer.
  function sanitizePomodoro(state) {
    const valid = state && ['idle', 'running', 'paused'].includes(state.status);
    return valid ? state : null;
  }

  function pomodoroRemainingMs() {
    if (!pomodoroState || pomodoroState.status === 'idle') {
      const mins = Number(settings?.pomodoroFocusMinutes) || 25;
      return mins * 60000;
    }
    if (pomodoroState.status === 'paused') return Math.max(0, pomodoroState.remainingMs || 0);
    return Math.max(0, (pomodoroState.phaseEndTime || Date.now()) - Date.now());
  }

  function renderPomodoro() {
    const phase = pomodoroState?.phase || 'focus';
    const status = pomodoroState?.status || 'idle';
    const isBreak = phase !== 'focus';

    els.pomoCard.classList.toggle('popup__pomodoro--break', isBreak);
    els.pomoDot.classList.toggle('popup__pomodoro-dot--running', status === 'running');
    els.pomoPhase.textContent = { focus: 'Focus', shortBreak: 'Short Break', longBreak: 'Long Break' }[phase] || 'Focus';
    els.pomoTime.textContent = formatTimer(pomodoroRemainingMs());
    els.pomoToggle.textContent = status === 'running' ? 'Pause' : (status === 'paused' ? 'Resume' : 'Start');

    const done = pomodoroState?.completedFocus || 0;
    els.pomoCycle.textContent = done > 0 ? '🍅'.repeat(Math.min(done, 8)) : '';
  }

  // ─── Session Controls ──────────────────────────────────────────────

  function bindEvents() {
    els.startBtn.addEventListener('click', handleStartSession);
    els.takeBreakBtn.addEventListener('click', handleTakeBreak);
    els.endBreakBtn.addEventListener('click', handleEndBreak);
    els.endSessionBtn.addEventListener('click', handleEndSession);
    els.emergencyBtn.addEventListener('click', handleEmergencyUnlock);
    els.dashboardBtn.addEventListener('click', handleOpenDashboard);
    els.optionsBtn.addEventListener('click', handleOpenOptions);
  }

  // Render break duration buttons from settings (falls back to 5/10/15).
  function renderBreakOptions() {
    const durations = Array.isArray(settings?.breakDurations) && settings.breakDurations.length
      ? settings.breakDurations
      : [5, 10, 15];
    const container = els.breakPicker?.querySelector('.popup__break-options');
    if (!container) return;

    container.innerHTML = durations
      .map(m => `<button class="popup__break-option" data-minutes="${m}">${m} min</button>`)
      .join('');

    container.querySelectorAll('.popup__break-option').forEach(btn => {
      btn.addEventListener('click', () => handleStartBreak(parseInt(btn.dataset.minutes, 10)));
    });
  }

  // ─── State Management ──────────────────────────────────────────────

  async function refreshState() {
    try {
      const status = await sendMessage({ type: 'GET_STATUS' });

      if (status?.active && status.session) {
        currentSession = status.session;
        showActiveState(status.session);
      } else {
        currentSession = null;
        showIdleState();
        await loadTodayStats();
      }
    } catch (e) {
      console.error('[FocusTube Popup] Error getting status:', e);
      showIdleState();
    }
  }

  function showIdleState() {
    els.stateIdle.classList.remove('popup__state--hidden');
    els.stateActive.classList.add('popup__state--hidden');
    els.statusBar.className = 'popup__status';
    els.statusText.textContent = 'Inactive';
    stopTimers();
  }

  function showActiveState(session) {
    els.stateIdle.classList.add('popup__state--hidden');
    els.stateActive.classList.remove('popup__state--hidden');

    // Update session info
    els.sessionTitle.textContent = session.lectureTitle || 'Untitled Lecture';

    if (session.goal) {
      els.sessionGoalWrapper.style.display = 'flex';
      els.sessionGoal.textContent = session.goal;
    } else {
      els.sessionGoalWrapper.style.display = 'none';
    }

    // Update live stats
    els.liveDistractions.textContent = session.distractionAttempts || 0;
    els.liveRecovered.textContent = session.recoveredSessions || 0;

    if (session.state === 'break') {
      showBreakState(session);
    } else {
      showStudyingState(session);
    }

    startTimer(session);
  }

  function showStudyingState(session) {
    els.statusBar.className = 'popup__status popup__status--active';
    els.statusText.textContent = 'Studying';
    els.breakInfo.classList.add('popup__break-info--hidden');
    els.breakPicker.classList.add('popup__break-picker--hidden');
    els.takeBreakBtn.style.display = '';
    els.sessionActions.style.display = '';
    els.timerLabel.textContent = 'Study Time';
  }

  function showBreakState(session) {
    els.statusBar.className = 'popup__status popup__status--break';
    els.statusText.textContent = 'On Break';
    els.breakInfo.classList.remove('popup__break-info--hidden');
    els.breakPicker.classList.add('popup__break-picker--hidden');
    els.takeBreakBtn.style.display = 'none';
    els.timerLabel.textContent = 'Total Study Time';

    startBreakTimer(session);
  }

  // ─── Timer Updates ──────────────────────────────────────────────────

  function startTimer(session) {
    stopTimers();

    updateTimer(session);
    timerInterval = setInterval(() => updateTimer(session), 1000);
  }

  function updateTimer(session) {
    let studyMs = session.totalStudyMs || 0;

    if (session.state === 'active' && session.counting) {
      studyMs += Date.now() - session.lastActiveTimestamp;
    }

    els.sessionTimer.textContent = formatTimer(studyMs);

    // Update focus score
    const totalMs = studyMs + (session.totalBreakMs || 0);
    const score = totalMs > 0 ? Math.round((studyMs / totalMs) * 100) : 100;
    els.liveFocusScore.textContent = score + '%';
  }

  function startBreakTimer(session) {
    clearInterval(breakTimerInterval);

    const updateBreak = () => {
      if (!session.breakEndTime) return;
      const remaining = Math.max(0, session.breakEndTime - Date.now());
      els.breakTimer.textContent = formatTimer(remaining);

      if (remaining <= 0) {
        clearInterval(breakTimerInterval);
        refreshState();
      }
    };

    updateBreak();
    breakTimerInterval = setInterval(updateBreak, 1000);
  }

  function stopTimers() {
    clearInterval(timerInterval);
    clearInterval(breakTimerInterval);
    timerInterval = null;
    breakTimerInterval = null;
  }

  // ─── Event Handlers ────────────────────────────────────────────────

  async function handleStartSession() {
    els.startHint.textContent = '';

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url || !tab.url.includes('youtube.com/watch')) {
      els.startHint.textContent = 'Please navigate to a YouTube video first.';
      return;
    }

    const goal = els.goalInput.value.trim();
    const lectureTitle = (tab.title || '')
      .replace(/^\(\d+\)\s*/, '')     // strip "(3) " unread-notification count
      .replace(/ - YouTube$/, '')
      .trim() || 'Untitled Lecture';

    // Extract keywords from title
    const keywords = extractKeywords(lectureTitle);

    const response = await sendMessage({
      type: 'START_SESSION',
      data: {
        lectureTitle,
        lectureUrl: tab.url,
        goal,
        keywords,
      },
    });

    if (response?.error) {
      els.startHint.textContent = response.error;
    } else {
      await refreshState();
    }
  }

  function handleTakeBreak() {
    const picker = els.breakPicker;
    if (picker.classList.contains('popup__break-picker--hidden')) {
      picker.classList.remove('popup__break-picker--hidden');
    } else {
      picker.classList.add('popup__break-picker--hidden');
    }
  }

  async function handleStartBreak(minutes) {
    els.breakPicker.classList.add('popup__break-picker--hidden');

    const response = await sendMessage({
      type: 'START_BREAK',
      data: { minutes },
    });

    if (response?.session) {
      currentSession = response.session;
      showActiveState(response.session);
    }
  }

  async function handleEndBreak() {
    const response = await sendMessage({ type: 'END_BREAK' });
    if (response?.session) {
      currentSession = response.session;
      showActiveState(response.session);
    }
  }

  async function handleEndSession() {
    const goalCompleted = currentSession?.goal
      ? confirm(`Did you complete your goal?\n\n"${currentSession.goal}"`)
      : false;

    const response = await sendMessage({
      type: 'END_SESSION',
      data: { goalCompleted },
    });

    if (response?.success) {
      await refreshState();
    }
  }

  async function handleEmergencyUnlock() {
    const phrase = settings?.emergencyUnlockPhrase || 'I choose to pause my study session';
    const duration = settings?.emergencyUnlockDurationMinutes || 10;

    const entered = prompt(
      `Type the following to unlock YouTube for ${duration} minutes:\n\n"${phrase}"`
    );

    if (entered?.trim().toLowerCase() === phrase.trim().toLowerCase()) {
      await sendMessage({ type: 'EMERGENCY_UNLOCK' });
      await refreshState();
    }
  }

  function handleOpenDashboard() {
    sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  }

  function handleOpenOptions() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  // ─── Today's Stats ─────────────────────────────────────────────────

  async function loadTodayStats() {
    try {
      const stats = await sendMessage({ type: 'GET_DAILY_STATS' });
      if (stats) {
        els.todayStudy.textContent = formatDuration(stats.totalStudyMs || 0);
        els.todayDistractions.textContent = stats.distractionAttempts || 0;

        const totalMs = (stats.totalStudyMs || 0) + (stats.totalBreakMs || 0);
        if (totalMs > 0) {
          const score = Math.round(((stats.totalStudyMs || 0) / totalMs) * 100);
          els.todayScore.textContent = score + '%';
        } else {
          els.todayScore.textContent = '—';
        }
      }
    } catch (e) {
      // Stats not available
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  function formatTimer(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '0m';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function extractKeywords(text) {
    if (!text) return [];
    const stopWords = new Set([
      'a','an','the','and','or','but','in','on','at','to','for','of','with',
      'by','from','is','it','this','that','are','was','video','tutorial',
      'lecture','part','full','course','class','lesson','hindi','english',
      'explained','learn','guide','tips','tricks','how','easy','simple',
      'best','top','new','latest','updated','2024','2025','2026',
    ]);
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w));
  }

  // ─── Start ─────────────────────────────────────────────────────────

  init();

})();
