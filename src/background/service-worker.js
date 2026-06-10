/**
 * FocusTube — Background Service Worker
 * Handles session management, alarms, navigation monitoring, badge, and notifications.
 */

import {
  ALARM_NAMES, MSG, SESSION_STATES, RESTRICTED_URL_PATTERNS,
  POMODORO_PHASES, POMODORO_STATUS,
} from '../shared/constants.js';
import {
  getSession, saveSession, clearSession,
  getDailyStats, updateDailyStats, addSessionToHistory,
  getSettings, cleanupOldData,
  getPomodoro, savePomodoro, clearPomodoro,
} from '../shared/storage.js';
import { generateUUID, formatDuration, getPageType, isYouTubeVideoUrl } from '../shared/utils.js';

// YouTube tab URL patterns (covers www, bare domain, and mobile).
const YT_TAB_PATTERNS = ['*://www.youtube.com/*', '*://youtube.com/*', '*://m.youtube.com/*'];

// ─── Initialization ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[FocusTube] Extension installed.');
    await cleanupOldData();
  }
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  // Resume distraction check alarm if session is active
  const session = await getSession();
  if (session && session.state === SESSION_STATES.ACTIVE) {
    startDistractionCheckAlarm();
  }
});

// ─── Message Handling ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[FocusTube] Message error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case MSG.START_SESSION:
      return await startSession(message.data);

    case MSG.END_SESSION:
      return await endSession(message.data);

    case MSG.GET_STATUS:
      return await getStatus();

    case MSG.START_BREAK:
      return await startBreak(message.data);

    case MSG.END_BREAK:
      return await endBreak();

    case MSG.EMERGENCY_UNLOCK:
      return await emergencyUnlock();

    case MSG.LOG_DISTRACTION:
      return await logDistraction();

    case MSG.LOG_RECOVERY:
      return await logRecovery();

    case MSG.NAVIGATE_TO_LECTURE:
      return await navigateToLecture(sender);

    case MSG.GET_DAILY_STATS:
      return await getDailyStats(message.data?.date);

    case MSG.GET_WEEKLY_STATS: {
      const { getWeeklyStats } = await import('../shared/storage.js');
      return await getWeeklyStats();
    }

    case MSG.GET_SESSION_HISTORY: {
      const { getSessionHistory } = await import('../shared/storage.js');
      return await getSessionHistory();
    }

    case MSG.COMPLETE_GOAL:
      return await completeGoal(message.data);

    case MSG.OPEN_DASHBOARD:
      return await openDashboard();

    case MSG.POMODORO_GET:
      return await getPomodoroState();

    case MSG.POMODORO_START:
      return await pomodoroStart();

    case MSG.POMODORO_PAUSE:
      return await pomodoroPause();

    case MSG.POMODORO_RESUME:
      return await pomodoroResume();

    case MSG.POMODORO_RESET:
      return await pomodoroReset();

    case MSG.POMODORO_SKIP:
      return await pomodoroSkip();

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Session Management ──────────────────────────────────────────────

async function startSession(data) {
  const existing = await getSession();
  if (existing && existing.state !== SESSION_STATES.ENDED) {
    return { error: 'Session already active' };
  }

  const session = {
    sessionId: generateUUID(),
    lectureTitle: data.lectureTitle || 'Untitled Lecture',
    lectureUrl: data.lectureUrl || '',
    startTime: Date.now(),
    goal: data.goal || '',
    state: SESSION_STATES.ACTIVE,
    totalStudyMs: 0,
    totalBreakMs: 0,
    distractionAttempts: 0,
    recoveredSessions: 0,
    goalCompleted: false,
    breakEndTime: null,
    emergencyUnlockUntil: null,
    lastActiveTimestamp: Date.now(),
    onLecture: true,        // Whether the user is currently on the lecture video
    offLectureSince: null,  // Timestamp of when they last left the lecture
    reminded: false,        // Whether a recovery reminder fired for the current away period
    keywords: data.keywords || [],
  };

  await saveSession(session);
  await updateBadge();

  // Start periodic alarms
  startSessionTickAlarm();
  startDistractionCheckAlarm();

  // Notify all YouTube tabs
  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });

  return { success: true, session };
}

async function endSession(data) {
  const session = await getSession();
  if (!session) return { error: 'No active session' };

  // Calculate final study time (the live portion only counts while on the lecture)
  if (session.state === SESSION_STATES.ACTIVE) {
    if (session.onLecture) {
      session.totalStudyMs += Date.now() - session.lastActiveTimestamp;
    }
  } else if (session.state === SESSION_STATES.BREAK) {
    session.totalBreakMs += Date.now() - (session.breakStartTime || session.lastActiveTimestamp);
  }

  session.state = SESSION_STATES.ENDED;
  session.goalCompleted = data?.goalCompleted || false;

  // Save to history
  await addSessionToHistory(session);

  // Update daily stats
  await updateDailyStats({
    totalStudyMs: session.totalStudyMs,
    totalBreakMs: session.totalBreakMs,
    distractionAttempts: session.distractionAttempts,
    recoveredSessions: session.recoveredSessions,
    sessionsCompleted: 1,
    goalsCompleted: session.goalCompleted ? 1 : 0,
  });

  // Clear session and alarms
  await clearSession();
  await clearAllAlarms();
  await updateBadge();

  // Notify tabs
  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: null });

  return { success: true };
}

async function getStatus() {
  const session = await getSession();
  if (!session || session.state === SESSION_STATES.ENDED) {
    return { active: false, session: null };
  }

  // Return the raw session — consumers (popup, overlay, badge) add the live
  // delta themselves from totalStudyMs + (now - lastActiveTimestamp).
  return { active: true, session };
}

// ─── Break Management ────────────────────────────────────────────────

async function startBreak(data) {
  const session = await getSession();
  if (!session || session.state !== SESSION_STATES.ACTIVE) {
    return { error: 'No active session to break from' };
  }

  // Accumulate study time so far (only on-lecture time counts as study)
  if (session.onLecture) {
    session.totalStudyMs += Date.now() - session.lastActiveTimestamp;
  }
  session.state = SESSION_STATES.BREAK;
  session.breakStartTime = Date.now();
  session.breakDurationMinutes = data?.minutes || 5;
  session.breakEndTime = Date.now() + (session.breakDurationMinutes * 60 * 1000);

  await saveSession(session);

  // Set break-end alarm
  chrome.alarms.create(ALARM_NAMES.BREAK_END, {
    when: session.breakEndTime,
  });

  await updateBadge();
  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });

  return { success: true, session };
}

async function endBreak() {
  const session = await getSession();
  if (!session || session.state !== SESSION_STATES.BREAK) {
    return { error: 'No break in progress' };
  }

  // Accumulate break time
  session.totalBreakMs += Date.now() - session.breakStartTime;
  session.state = SESSION_STATES.ACTIVE;
  session.lastActiveTimestamp = Date.now();
  session.breakEndTime = null;
  session.breakStartTime = null;
  session.breakDurationMinutes = null;

  await saveSession(session);
  chrome.alarms.clear(ALARM_NAMES.BREAK_END);

  await updateBadge();
  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });

  return { success: true, session };
}

// ─── Emergency Unlock ────────────────────────────────────────────────

async function emergencyUnlock() {
  const session = await getSession();
  if (!session) return { error: 'No active session' };

  const settings = await getSettings();
  const durationMs = (settings.emergencyUnlockDurationMinutes || 10) * 60 * 1000;

  session.emergencyUnlockUntil = Date.now() + durationMs;
  await saveSession(session);

  // Set alarm to end unlock period
  chrome.alarms.create(ALARM_NAMES.EMERGENCY_UNLOCK_END, {
    when: session.emergencyUnlockUntil,
  });

  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });

  return { success: true, unlockUntil: session.emergencyUnlockUntil };
}

// ─── Distraction & Recovery Logging ──────────────────────────────────

async function logDistraction() {
  const session = await getSession();
  if (!session) return { error: 'No active session' };

  session.distractionAttempts++;
  await saveSession(session);

  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });
  return { success: true, count: session.distractionAttempts };
}

async function logRecovery() {
  const session = await getSession();
  if (!session) return { error: 'No active session' };

  session.recoveredSessions++;
  await saveSession(session);

  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });
  return { success: true, count: session.recoveredSessions };
}

// ─── Goal Completion ─────────────────────────────────────────────────

async function completeGoal(data) {
  const session = await getSession();
  if (!session) return { error: 'No active session' };

  session.goalCompleted = data?.completed ?? true;
  await saveSession(session);

  return { success: true };
}

// ─── Navigation ──────────────────────────────────────────────────────

async function navigateToLecture(sender) {
  const session = await getSession();
  if (!session || !session.lectureUrl) {
    return { error: 'No lecture URL stored' };
  }

  // Navigate the sender's tab or find a YouTube tab
  const tabId = sender?.tab?.id;
  if (tabId) {
    await chrome.tabs.update(tabId, { url: session.lectureUrl });
  } else {
    const tabs = await chrome.tabs.query({ url: YT_TAB_PATTERNS });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { url: session.lectureUrl, active: true });
    } else {
      await chrome.tabs.create({ url: session.lectureUrl });
    }
  }

  return { success: true };
}

async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const tabs = await chrome.tabs.query({ url: dashboardUrl });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }

  return { success: true };
}

// ─── Standalone Pomodoro Timer ───────────────────────────────────────

function pomodoroConfig(settings) {
  const m = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
  return {
    focusMs: m(settings.pomodoroFocusMinutes, 25) * 60000,
    shortMs: m(settings.pomodoroShortBreakMinutes, 5) * 60000,
    longMs:  m(settings.pomodoroLongBreakMinutes, 15) * 60000,
    cycles:  Math.max(1, Math.round(settings.pomodoroCyclesBeforeLongBreak || 4)),
    autoStart: settings.pomodoroAutoStartNext !== false,
  };
}

function phaseDuration(phase, cfg) {
  if (phase === POMODORO_PHASES.SHORT_BREAK) return cfg.shortMs;
  if (phase === POMODORO_PHASES.LONG_BREAK) return cfg.longMs;
  return cfg.focusMs;
}

function freshPomodoro() {
  return {
    status: POMODORO_STATUS.IDLE,
    phase: POMODORO_PHASES.FOCUS,
    phaseEndTime: null,
    remainingMs: null,
    phaseDurationMs: 0,
    completedFocus: 0,
  };
}

async function getPomodoroState() {
  return (await getPomodoro()) || freshPomodoro();
}

function setPomodoroAlarm(state) {
  if (state.status === POMODORO_STATUS.RUNNING && state.phaseEndTime) {
    chrome.alarms.create(ALARM_NAMES.POMODORO_PHASE, { when: state.phaseEndTime });
  }
}

// Notify tabs (floating clock) and extension pages (popup/options).
function broadcastPomodoro(state) {
  broadcastToAllTabs({ type: MSG.POMODORO_UPDATED, data: state });
  chrome.runtime.sendMessage({ type: MSG.POMODORO_UPDATED, data: state }).catch(() => {});
}

async function commitPomodoro(state) {
  await savePomodoro(state);
  setPomodoroAlarm(state);
  broadcastPomodoro(state);
  return state;
}

async function pomodoroStart() {
  const settings = await getSettings();
  const cfg = pomodoroConfig(settings);
  let state = await getPomodoroState();

  if (state.status === POMODORO_STATUS.RUNNING) return state;

  if (state.status === POMODORO_STATUS.PAUSED && state.remainingMs > 0) {
    // Resume the paused phase from where it left off.
    state.phaseEndTime = Date.now() + state.remainingMs;
  } else {
    // Begin a fresh focus phase.
    state = freshPomodoro();
    state.phase = POMODORO_PHASES.FOCUS;
    state.phaseDurationMs = phaseDuration(state.phase, cfg);
    state.phaseEndTime = Date.now() + state.phaseDurationMs;
  }
  state.status = POMODORO_STATUS.RUNNING;
  state.remainingMs = null;

  return commitPomodoro(state);
}

async function pomodoroPause() {
  const state = await getPomodoroState();
  if (state.status !== POMODORO_STATUS.RUNNING) return state;

  state.remainingMs = Math.max(0, (state.phaseEndTime || Date.now()) - Date.now());
  state.phaseEndTime = null;
  state.status = POMODORO_STATUS.PAUSED;

  chrome.alarms.clear(ALARM_NAMES.POMODORO_PHASE);
  await savePomodoro(state);
  broadcastPomodoro(state);
  return state;
}

async function pomodoroResume() {
  return pomodoroStart(); // start() resumes a paused phase
}

async function pomodoroReset() {
  const state = freshPomodoro();
  chrome.alarms.clear(ALARM_NAMES.POMODORO_PHASE);
  await savePomodoro(state);
  broadcastPomodoro(state);
  return state;
}

async function pomodoroSkip() {
  const state = await getPomodoroState();
  if (state.status === POMODORO_STATUS.IDLE) return state;
  return advancePomodoro(state, true);
}

async function handlePomodoroPhaseEnd() {
  const state = await getPomodoroState();
  if (state.status !== POMODORO_STATUS.RUNNING) return;
  await advancePomodoro(state, false);
}

// Advance focus → break → focus …, optionally auto-starting the next phase.
async function advancePomodoro(state, viaSkip) {
  const settings = await getSettings();
  const cfg = pomodoroConfig(settings);
  const endedPhase = state.phase;

  let nextPhase;
  if (endedPhase === POMODORO_PHASES.FOCUS) {
    state.completedFocus += 1;
    nextPhase = (state.completedFocus % cfg.cycles === 0)
      ? POMODORO_PHASES.LONG_BREAK
      : POMODORO_PHASES.SHORT_BREAK;
  } else {
    nextPhase = POMODORO_PHASES.FOCUS;
  }

  state.phase = nextPhase;
  state.phaseDurationMs = phaseDuration(nextPhase, cfg);

  // A manual skip always rolls straight into the next phase; otherwise honor auto-start.
  if (viaSkip || cfg.autoStart) {
    state.status = POMODORO_STATUS.RUNNING;
    state.phaseEndTime = Date.now() + state.phaseDurationMs;
    state.remainingMs = null;
  } else {
    state.status = POMODORO_STATUS.PAUSED;
    state.phaseEndTime = null;
    state.remainingMs = state.phaseDurationMs;
  }

  await commitPomodoro(state);

  // Notify + chime only when a phase ends on its own (not on a manual skip).
  if (!viaSkip) {
    notifyPomodoroPhase(nextPhase);
    await playAlarmSound(settings);
  }
  return state;
}

function notifyPomodoroPhase(nextPhase) {
  const isBreakNext = nextPhase !== POMODORO_PHASES.FOCUS;
  const label = nextPhase === POMODORO_PHASES.LONG_BREAK ? 'long break'
    : nextPhase === POMODORO_PHASES.SHORT_BREAK ? 'short break'
    : 'focus session';

  chrome.notifications.create('pomodoro-phase', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: isBreakNext ? 'Focus complete! 🍅' : 'Break over — back to focus 💪',
    message: isBreakNext ? `Nice work. Time for a ${label}.` : `Starting your next ${label}.`,
    priority: 2,
    requireInteraction: true,
  });
}

// ─── Offscreen Audio (alarm sounds) ──────────────────────────────────

async function playAlarmSound(settings) {
  const sound = settings.pomodoroAlarmSound || 'chime';
  if (sound === 'none') return;

  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PLAY_ALARM',
      sound,
      volume: typeof settings.pomodoroAlarmVolume === 'number' ? settings.pomodoroAlarmVolume : 0.7,
    });
  } catch (e) {
    console.warn('[FocusTube] Could not play alarm sound:', e);
  }
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) {
    const has = await chrome.offscreen.hasDocument();
    if (has) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play the Pomodoro alarm sound when a focus or break period ends.',
    });
  } catch (e) {
    // A document may already exist due to a race — that's fine.
    if (!String(e?.message || '').includes('Only a single offscreen')) throw e;
  }
}

// ─── Floating Clock Injection ────────────────────────────────────────
// Content scripts only auto-inject into pages loaded after the extension
// starts. When the user flips the clock on, push it into every open tab so
// it appears immediately — no page refresh needed. The script's own guard
// prevents double-mounting where it is already loaded.

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;

  const wasEnabled = changes.settings.oldValue?.floatingClockEnabled === true;
  const isEnabled = changes.settings.newValue?.floatingClockEnabled === true;
  if (!isEnabled || wasEnabled) return;

  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['src/content/floating-clock.css'],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/floating-clock.js'],
      });
    } catch {
      // Tab not injectable (Web Store, browser pages, etc.) — skip it.
    }
  }
});

// ─── Alarm Handling ──────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {

    case ALARM_NAMES.BREAK_END:
      await handleBreakEnd();
      break;

    case ALARM_NAMES.EMERGENCY_UNLOCK_END:
      await handleEmergencyUnlockEnd();
      break;

    case ALARM_NAMES.DISTRACTION_CHECK:
      await handleDistractionCheck();
      break;

    case ALARM_NAMES.SESSION_TICK:
      await handleSessionTick();
      break;

    case ALARM_NAMES.POMODORO_PHASE:
      await handlePomodoroPhaseEnd();
      break;
  }
});

async function handleBreakEnd() {
  const session = await getSession();
  if (!session || session.state !== SESSION_STATES.BREAK) return;

  // Show notification
  chrome.notifications.create('break-end', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: 'Break Finished! ☕',
    message: `Time to get back to: ${session.lectureTitle}`,
    priority: 2,
    requireInteraction: true,
  });

  // Auto-end break
  await endBreak();
}

async function handleEmergencyUnlockEnd() {
  const session = await getSession();
  if (!session) return;

  session.emergencyUnlockUntil = null;
  await saveSession(session);

  chrome.notifications.create('unlock-end', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: 'Emergency Unlock Expired 🔒',
    message: 'FocusTube protections are active again.',
    priority: 2,
  });

  broadcastToYouTubeTabs({ type: MSG.SESSION_UPDATED, data: session });
}

async function handleDistractionCheck() {
  const session = await getSession();
  if (!session || session.state !== SESSION_STATES.ACTIVE) return;

  // Only remind once per away period, and only while actually off the lecture.
  if (session.onLecture || !session.offLectureSince || session.reminded) return;

  const settings = await getSettings();
  const reminderMs = (settings.recoveryReminderMinutes || 15) * 60 * 1000;
  const awayMs = Date.now() - session.offLectureSince;

  if (awayMs >= reminderMs) {
    session.reminded = true;
    await saveSession(session);

    chrome.notifications.create('recovery-reminder', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
      title: `You left your study session ${formatDuration(awayMs)} ago`,
      message: `Return to: ${session.lectureTitle}`,
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: 'Resume Study' }],
    });
  }
}

async function handleSessionTick() {
  await updateBadge();
}

// Bring the lecture into focus in an existing YouTube tab, or open a new one.
async function focusLectureTab() {
  const session = await getSession();
  if (!session?.lectureUrl) return;

  const tabs = await chrome.tabs.query({ url: YT_TAB_PATTERNS });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: session.lectureUrl, active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: session.lectureUrl });
  }
}

// Handle notification body clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (['recovery-reminder', 'break-end', 'pomodoro-break'].includes(notificationId)) {
    await focusLectureTab();
    chrome.notifications.clear(notificationId);
  }
});

// Handle notification action-button clicks (e.g. "Resume Study")
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId === 'recovery-reminder' && buttonIndex === 0) {
    await focusLectureTab();
    chrome.notifications.clear(notificationId);
  }
});

// ─── URL Monitoring (SPA Navigation) ─────────────────────────────────

// Covers both SPA navigations (onHistoryStateUpdated — how YouTube usually
// moves between pages) and full page loads (onCommitted — reloads, new tabs),
// so lecture-presence tracking never goes stale.
async function handleYouTubeNavigation(details) {
  if (details.frameId !== 0) return; // Only main frame

  const session = await getSession();
  if (!session || session.state === SESSION_STATES.ENDED) return;

  const pageType = getPageType(details.url);

  // Track lecture presence so study time only accrues while on the lecture,
  // and so distraction recovery knows when the user wandered off.
  if (session.state === SESSION_STATES.ACTIVE) {
    const lectureVideoId = getVideoIdFromUrl(session.lectureUrl);
    const isOnLecture = pageType === 'watch' && !!lectureVideoId &&
      getVideoIdFromUrl(details.url) === lectureVideoId;

    if (isOnLecture && !session.onLecture) {
      // Returned to the lecture — credit a recovery if a reminder had fired.
      if (session.reminded) session.recoveredSessions++;
      session.onLecture = true;
      session.offLectureSince = null;
      session.reminded = false;
      session.lastActiveTimestamp = Date.now();
      await saveSession(session);
    } else if (!isOnLecture && session.onLecture) {
      // Left the lecture — bank the study time accrued so far and stop counting.
      session.totalStudyMs += Date.now() - session.lastActiveTimestamp;
      session.onLecture = false;
      session.offLectureSince = Date.now();
      await saveSession(session);
    }
  }

  // Send page change event to content script
  try {
    await chrome.tabs.sendMessage(details.tabId, {
      type: MSG.PAGE_CHANGED,
      data: { url: details.url, pageType },
    });
  } catch {
    // Tab might not have content script loaded
  }
}

const YT_NAV_FILTER = { url: [{ hostContains: 'youtube.com' }] };
chrome.webNavigation.onHistoryStateUpdated.addListener(handleYouTubeNavigation, YT_NAV_FILTER);
chrome.webNavigation.onCommitted.addListener(handleYouTubeNavigation, YT_NAV_FILTER);

function getVideoIdFromUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).searchParams.get('v') || '';
  } catch {
    return '';
  }
}

// ─── Alarm Setup Helpers ─────────────────────────────────────────────

function startSessionTickAlarm() {
  chrome.alarms.create(ALARM_NAMES.SESSION_TICK, {
    periodInMinutes: 1,
  });
}

function startDistractionCheckAlarm() {
  chrome.alarms.create(ALARM_NAMES.DISTRACTION_CHECK, {
    periodInMinutes: 5,
  });
}

async function clearAllAlarms() {
  for (const name of Object.values(ALARM_NAMES)) {
    await chrome.alarms.clear(name);
  }
}

// ─── Badge Updates ───────────────────────────────────────────────────

async function updateBadge() {
  const session = await getSession();

  if (!session || session.state === SESSION_STATES.ENDED) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#666666' });
    return;
  }

  if (session.state === SESSION_STATES.BREAK) {
    await chrome.action.setBadgeText({ text: 'BRK' });
    await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
    return;
  }

  // Show elapsed study time (the live portion only counts while on the lecture)
  const elapsed = session.totalStudyMs +
    (session.onLecture ? Date.now() - session.lastActiveTimestamp : 0);
  const minutes = Math.floor(elapsed / 60000);
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#6C3CE1' });
}

// ─── Broadcast Helper ────────────────────────────────────────────────

async function broadcastToYouTubeTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: YT_TAB_PATTERNS });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch {
        // Content script may not be loaded
      }
    }
  } catch {
    // Tabs query may fail
  }
}

// Broadcast to every tab (used by the floating clock, which runs on all sites).
async function broadcastToAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch {
    // Tabs query may fail
  }
}
