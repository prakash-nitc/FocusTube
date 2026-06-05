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
    pomodoroEnabled: false,
    pomodoroPreset: '25/5',
    recoveryReminderMinutes: 15,
    emergencyUnlockPhrase: 'I choose to pause my study session',
    emergencyUnlockDurationMinutes: 10,
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

    // Toggles
    $('#toggle-sidebar').checked = s.hideSidebar;
    $('#toggle-recommendations').checked = s.hideRecommendations;
    $('#toggle-shorts').checked = s.hideShorts;
    $('#toggle-comments').checked = s.hideComments;
    $('#toggle-endcards').checked = s.hideEndCards;

    // Pomodoro
    $('#toggle-pomodoro').checked = s.pomodoroEnabled;
    updatePomodoroUI(s.pomodoroEnabled);
    setActivePreset(s.pomodoroPreset);

    // Recovery
    $('#recovery-interval').value = String(s.recoveryReminderMinutes);

    // Emergency
    $('#unlock-phrase').value = s.emergencyUnlockPhrase;
    $('#unlock-duration').value = String(s.emergencyUnlockDurationMinutes);
  }

  // ─── Bind Events ───────────────────────────────────────────────────

  function bindEvents() {
    // Pomodoro toggle
    $('#toggle-pomodoro').addEventListener('change', (e) => {
      updatePomodoroUI(e.target.checked);
    });

    // Pomodoro presets
    $$('.options__preset').forEach(btn => {
      btn.addEventListener('click', () => {
        setActivePreset(btn.dataset.preset);
      });
    });

    // Save
    $('#save-btn').addEventListener('click', saveSettings);
  }

  // ─── Save Settings ─────────────────────────────────────────────────

  async function saveSettings() {
    const settings = {
      strictnessLevel: $('input[name="strictness"]:checked')?.value || 'standard',
      hideSidebar: $('#toggle-sidebar').checked,
      hideRecommendations: $('#toggle-recommendations').checked,
      hideShorts: $('#toggle-shorts').checked,
      hideComments: $('#toggle-comments').checked,
      hideEndCards: $('#toggle-endcards').checked,
      pomodoroEnabled: $('#toggle-pomodoro').checked,
      pomodoroPreset: getActivePreset(),
      recoveryReminderMinutes: parseInt($('#recovery-interval').value, 10) || 15,
      emergencyUnlockPhrase: $('#unlock-phrase').value.trim() || DEFAULT_SETTINGS.emergencyUnlockPhrase,
      emergencyUnlockDurationMinutes: parseInt($('#unlock-duration').value, 10) || 10,
    };

    // Merge with existing settings (preserve fields not on this page)
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

  // ─── UI Helpers ────────────────────────────────────────────────────

  function updatePomodoroUI(enabled) {
    const presets = $('#pomodoro-presets');
    if (enabled) {
      presets.classList.add('options__pomodoro-presets--active');
    } else {
      presets.classList.remove('options__pomodoro-presets--active');
    }
  }

  function setActivePreset(preset) {
    $$('.options__preset').forEach(btn => {
      btn.classList.toggle('options__preset--active', btn.dataset.preset === preset);
    });
  }

  function getActivePreset() {
    const active = $('.options__preset--active');
    return active?.dataset?.preset || '25/5';
  }

  // ─── Start ─────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
