/**
 * FocusTube — Options Page Logic
 * Loads, displays, and saves extension settings.
 */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const DEFAULT_SETTINGS = {
    strictnessLevel: 'standard',
    hideSidebar: true,
    hideRecommendations: true,
    hideShorts: true,
    hideComments: true,
    hideEndCards: true,
    pomodoroFocusMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroCyclesBeforeLongBreak: 4,
    pomodoroAutoStartNext: true,
    pomodoroAlarmSound: 'chime',
    pomodoroAlarmVolume: 0.7,
    floatingClockEnabled: false,
    recoveryReminderMinutes: 15,
    emergencyUnlockPhrase: 'I choose to pause my study session',
    emergencyUnlockDurationMinutes: 10,
  };

  // Presets fill the focus/break fields when clicked.
  const PRESETS = {
    '25/5':  { focus: 25, shortBreak: 5,  longBreak: 15 },
    '50/10': { focus: 50, shortBreak: 10, longBreak: 20 },
    '90/15': { focus: 90, shortBreak: 15, longBreak: 30 },
  };

  // ─── Initialization ───────────────────────────────────────────────

  async function init() {
    await loadSettings();
    bindEvents();
  }

  // ─── Load Settings ─────────────────────────────────────────────────

  async function loadSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    // Strictness
    if (s.strictnessLevel === 'strict') {
      $('#strictness-strict').checked = true;
    } else {
      $('#strictness-standard').checked = true;
    }

    // Clean Room toggles
    $('#toggle-sidebar').checked = s.hideSidebar;
    $('#toggle-recommendations').checked = s.hideRecommendations;
    $('#toggle-shorts').checked = s.hideShorts;
    $('#toggle-comments').checked = s.hideComments;
    $('#toggle-endcards').checked = s.hideEndCards;

    // Pomodoro
    $('#focus-minutes').value = String(s.pomodoroFocusMinutes);
    $('#short-break-minutes').value = String(s.pomodoroShortBreakMinutes);
    $('#long-break-minutes').value = String(s.pomodoroLongBreakMinutes);
    $('#cycles-before-long').value = String(s.pomodoroCyclesBeforeLongBreak);
    $('#toggle-autostart').checked = s.pomodoroAutoStartNext;
    $('#alarm-sound').value = s.pomodoroAlarmSound;
    $('#alarm-volume').value = String(Math.round((s.pomodoroAlarmVolume ?? 0.7) * 100));

    // Floating clock
    $('#toggle-floating-clock').checked = s.floatingClockEnabled;

    // Recovery
    $('#recovery-interval').value = String(s.recoveryReminderMinutes);

    // Emergency
    $('#unlock-phrase').value = s.emergencyUnlockPhrase;
    $('#unlock-duration').value = String(s.emergencyUnlockDurationMinutes);
  }

  // ─── Bind Events ───────────────────────────────────────────────────

  function bindEvents() {
    // Presets fill the number inputs
    $$('.options__preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = PRESETS[btn.dataset.preset];
        if (!preset) return;
        $('#focus-minutes').value = String(preset.focus);
        $('#short-break-minutes').value = String(preset.shortBreak);
        $('#long-break-minutes').value = String(preset.longBreak);
        $$('.options__preset').forEach(b => b.classList.toggle('options__preset--active', b === btn));
      });
    });

    // − / + stepper buttons on the number fields
    $$('.options__step').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const step = parseInt(btn.dataset.step, 10) || 1;
        const min = parseInt(input.min, 10);
        const max = parseInt(input.max, 10);
        let val = (parseInt(input.value, 10) || 0) + step;
        if (Number.isFinite(min)) val = Math.max(min, val);
        if (Number.isFinite(max)) val = Math.min(max, val);
        input.value = String(val);
      });
    });

    // Test the selected alarm sound
    $('#test-sound').addEventListener('click', () => {
      const sound = $('#alarm-sound').value;
      const volume = (parseInt($('#alarm-volume').value, 10) || 0) / 100;
      if (sound !== 'none') playTone(sound, volume);
    });

    // Save
    $('#save-btn').addEventListener('click', saveSettings);
  }

  // ─── Save Settings ─────────────────────────────────────────────────

  function clampNum(sel, def, min, max) {
    const v = parseInt($(sel).value, 10);
    if (!Number.isFinite(v)) return def;
    return Math.max(min, Math.min(max, v));
  }

  async function saveSettings() {
    const settings = {
      strictnessLevel: $('input[name="strictness"]:checked')?.value || 'standard',
      hideSidebar: $('#toggle-sidebar').checked,
      hideRecommendations: $('#toggle-recommendations').checked,
      hideShorts: $('#toggle-shorts').checked,
      hideComments: $('#toggle-comments').checked,
      hideEndCards: $('#toggle-endcards').checked,
      pomodoroFocusMinutes: clampNum('#focus-minutes', 25, 1, 180),
      pomodoroShortBreakMinutes: clampNum('#short-break-minutes', 5, 1, 60),
      pomodoroLongBreakMinutes: clampNum('#long-break-minutes', 15, 1, 90),
      pomodoroCyclesBeforeLongBreak: clampNum('#cycles-before-long', 4, 1, 12),
      pomodoroAutoStartNext: $('#toggle-autostart').checked,
      pomodoroAlarmSound: $('#alarm-sound').value,
      pomodoroAlarmVolume: (parseInt($('#alarm-volume').value, 10) || 70) / 100,
      floatingClockEnabled: $('#toggle-floating-clock').checked,
      recoveryReminderMinutes: parseInt($('#recovery-interval').value, 10) || 15,
      emergencyUnlockPhrase: $('#unlock-phrase').value.trim() || DEFAULT_SETTINGS.emergencyUnlockPhrase,
      emergencyUnlockDurationMinutes: parseInt($('#unlock-duration').value, 10) || 10,
    };

    // Merge with existing settings (preserve fields not on this page, e.g. clock position).
    const { settings: existing } = await chrome.storage.local.get('settings');
    const merged = { ...(existing || {}), ...settings };

    await chrome.storage.local.set({ settings: merged });

    // Show saved feedback
    const status = $('#save-status');
    status.textContent = '✓ Settings saved';
    status.classList.add('options__save-status--visible');
    setTimeout(() => {
      status.classList.remove('options__save-status--visible');
    }, 2000);
  }

  // ─── Alarm Tone Preview (matches the offscreen player) ──────────────

  const SOUND_PATTERNS = {
    chime: { type: 'sine',   notes: [[880, 0], [1108.73, 0.16], [1318.51, 0.32]], dur: 0.6 },
    bell:  { type: 'sine',   notes: [[660, 0], [990, 0]],                          dur: 1.4 },
    beep:  { type: 'square', notes: [[720, 0], [720, 0.22], [720, 0.44]],          dur: 0.14 },
  };

  function playTone(soundName, volume) {
    const pattern = SOUND_PATTERNS[soundName] || SOUND_PATTERNS.chime;
    const vol = Math.max(0, Math.min(1, typeof volume === 'number' ? volume : 0.7));
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    let latestEnd = now;

    for (const [freq, offset] of pattern.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = pattern.type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = now + offset;
      const end = start + pattern.dur;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(vol, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.start(start);
      osc.stop(end + 0.03);
      latestEnd = Math.max(latestEnd, end);
    }
    setTimeout(() => ctx.close().catch(() => {}), (latestEnd - now + 0.2) * 1000);
  }

  // ─── Start ─────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
