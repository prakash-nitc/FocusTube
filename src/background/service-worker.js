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

  // Calculate final study time
  if (session.state === SESSION_STATES.ACTIVE) {
    session.totalStudyMs += Date.now() - session.lastActiveTimestamp;
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

  // Calculate live study time
  const live = { ...session };
  if (live.state === SESSION_STATES.ACTIVE) {
    live.totalStudyMs += Date.now() - live.lastActiveTimestamp;
  }

  return { active: true, session: live };
}

// ─── Break Management ────────────────────────────────────────────────

async function startBreak(data) {
  const session = await getSession();
  if (!session || session.state !== SESSION_STATES.ACTIVE) {
    return { error: 'No active session to break from' };
  }

  // Accumulate study time so far
  session.totalStudyMs += Date.now() - session.lastActiveTimestamp;
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
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
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

  const settings = await getSettings();

  // Check if any YouTube tab is on the lecture URL
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  const onLecture = tabs.some(t => t.url && t.url.includes(session.lectureUrl?.split('?')[0]?.split('&')[0]));

  if (!onLecture && tabs.length > 0) {
    const awayMs = Date.now() - session.lastActiveTimestamp;
    const reminderMs = (settings.recoveryReminderMinutes || 15) * 60 * 1000;

    if (awayMs >= reminderMs) {
      const awayFormatted = formatDuration(awayMs);
      chrome.notifications.create('recovery-reminder', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
        title: `You left your study session ${awayFormatted} ago`,
        message: `Return to: ${session.lectureTitle}`,
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: 'Resume Study' }],
      });
    }
  }
}

async function handleSessionTick() {
  await updateBadge();
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId === 'recovery-reminder' || notificationId === 'break-end') {
    const session = await getSession();
    if (session?.lectureUrl) {
      const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url: session.lectureUrl, active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: session.lectureUrl });
      }
    }
    chrome.notifications.clear(notificationId);
  }
});

// ─── URL Monitoring (SPA Navigation) ─────────────────────────────────

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return; // Only main frame

  const session = await getSession();
  if (!session || session.state === SESSION_STATES.ENDED) return;

  // Check if emergency unlocked
  if (session.emergencyUnlockUntil && Date.now() < session.emergencyUnlockUntil) {
    return; // Allow all navigation during unlock
  }

  const pageType = getPageType(details.url);

  // Update last active timestamp if watching lecture
  if (pageType === 'watch' && details.url.includes(getVideoIdFromUrl(session.lectureUrl))) {
    session.lastActiveTimestamp = Date.now();
    await saveSession(session);
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

  // Show elapsed study time
  const elapsed = session.totalStudyMs + (Date.now() - session.lastActiveTimestamp);
  const minutes = Math.floor(elapsed / 60000);
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#6C3CE1' });
}

// ─── Broadcast Helper ────────────────────────────────────────────────

async function broadcastToYouTubeTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
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
