/**
 * FocusTube — Background Service Worker
 * Handles session management, alarms, navigation monitoring, badge, and notifications.
 */

import { ALARM_NAMES, MSG, SESSION_STATES, RESTRICTED_URL_PATTERNS } from '../shared/constants.js';
import {
  getSession, saveSession, clearSession,
  getDailyStats, updateDailyStats, addSessionToHistory,
  getSettings, cleanupOldData,
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

  const settings = await getSettings();

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
    pomodoro: null,
  };

  if (settings.pomodoroEnabled) {
    const preset = settings.pomodoroPresets?.[settings.pomodoroPreset] || { study: 25, break: 5 };
    session.pomodoro = { study: preset.study, break: preset.break, preset: settings.pomodoroPreset };
  }

  await saveSession(session);
  await updateBadge();

  // Start periodic alarms
  startSessionTickAlarm();
  startDistractionCheckAlarm();
  if (session.pomodoro) {
    chrome.alarms.create(ALARM_NAMES.POMODORO_STUDY, { delayInMinutes: session.pomodoro.study });
  }

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

  // Set break-end alarm; pause any pending Pomodoro study-period alarm
  chrome.alarms.create(ALARM_NAMES.BREAK_END, {
    when: session.breakEndTime,
  });
  chrome.alarms.clear(ALARM_NAMES.POMODORO_STUDY);

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

  // Resume the Pomodoro cycle: schedule the next study period.
  if (session.pomodoro) {
    chrome.alarms.create(ALARM_NAMES.POMODORO_STUDY, { delayInMinutes: session.pomodoro.study });
  }

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

    case ALARM_NAMES.POMODORO_STUDY:
      await handlePomodoroStudyEnd();
      break;
  }
});

async function handlePomodoroStudyEnd() {
  const session = await getSession();
  if (!session || session.state !== SESSION_STATES.ACTIVE || !session.pomodoro) return;

  chrome.notifications.create('pomodoro-break', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: 'Pomodoro complete! 🍅',
    message: `Nice focus. Time for a ${session.pomodoro.break}-minute break.`,
    priority: 2,
    requireInteraction: true,
  });

  // Automatically start the break; endBreak() reschedules the next study period.
  await startBreak({ minutes: session.pomodoro.break });
}

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

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
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
}, {
  url: [{ hostContains: 'youtube.com' }],
});

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
