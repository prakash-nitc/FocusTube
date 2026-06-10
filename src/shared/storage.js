/**
 * FocusTube — Storage Abstraction Layer
 * Clean API over chrome.storage.local with defaults and helpers.
 */

import { DEFAULT_SETTINGS } from './constants.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function getToday() {
  return new Date().toISOString().split('T')[0]; // "2026-06-05"
}

function getWeekKey() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay()); // Sunday
  return start.toISOString().split('T')[0];
}

async function get(keys) {
  return chrome.storage.local.get(keys);
}

async function set(data) {
  return chrome.storage.local.set(data);
}

// ─── Session ─────────────────────────────────────────────────────────

export async function getSession() {
  const { activeSession } = await get('activeSession');
  if (!activeSession) return null;

  // Migrate sessions created before lecture-presence tracking existed,
  // so their study timer keeps ticking after an extension update.
  if (activeSession.onLecture === undefined) {
    activeSession.onLecture = true;
    activeSession.offLectureSince = null;
    activeSession.reminded = false;
  }
  return activeSession;
}

export async function saveSession(session) {
  await set({ activeSession: session });
}

export async function clearSession() {
  await chrome.storage.local.remove('activeSession');
}

// ─── Daily Stats ─────────────────────────────────────────────────────

export async function getDailyStats(date) {
  const key = date || getToday();
  const { dailyStats } = await get('dailyStats');
  const allStats = dailyStats || {};
  return allStats[key] || createEmptyDayStats();
}

export async function getAllDailyStats() {
  const { dailyStats } = await get('dailyStats');
  return dailyStats || {};
}

export async function updateDailyStats(updates) {
  const key = getToday();
  const { dailyStats } = await get('dailyStats');
  const allStats = dailyStats || {};
  const todayStats = allStats[key] || createEmptyDayStats();

  // Merge updates
  for (const [field, value] of Object.entries(updates)) {
    if (typeof value === 'number' && typeof todayStats[field] === 'number') {
      todayStats[field] += value;
    } else {
      todayStats[field] = value;
    }
  }

  allStats[key] = todayStats;
  await set({ dailyStats: allStats });
  return todayStats;
}

function createEmptyDayStats() {
  return {
    totalStudyMs: 0,
    totalBreakMs: 0,
    distractionAttempts: 0,
    recoveredSessions: 0,
    sessionsCompleted: 0,
    goalsCompleted: 0,
  };
}

// ─── Weekly Stats ────────────────────────────────────────────────────

export async function getWeeklyStats() {
  const { dailyStats } = await get('dailyStats');
  const allStats = dailyStats || {};
  const today = new Date();
  const result = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    result.push({
      date: key,
      day: dayName,
      ...(allStats[key] || createEmptyDayStats()),
    });
  }

  return result;
}

// ─── Session History ─────────────────────────────────────────────────

export async function getSessionHistory() {
  const { sessionHistory } = await get('sessionHistory');
  return sessionHistory || [];
}

export async function addSessionToHistory(session) {
  const { sessionHistory } = await get('sessionHistory');
  const history = sessionHistory || [];

  history.unshift({
    sessionId: session.sessionId,
    lectureTitle: session.lectureTitle,
    lectureUrl: session.lectureUrl,
    startTime: session.startTime,
    endTime: Date.now(),
    totalStudyMs: session.totalStudyMs,
    totalBreakMs: session.totalBreakMs,
    distractionAttempts: session.distractionAttempts,
    recoveredSessions: session.recoveredSessions,
    goal: session.goal,
    goalCompleted: session.goalCompleted || false,
    focusScore: calculateFocusScore(session),
  });

  // Keep last 100 sessions
  if (history.length > 100) history.length = 100;

  await set({ sessionHistory: history });
  return history;
}

function calculateFocusScore(session) {
  const total = session.totalStudyMs + session.totalBreakMs;
  if (total === 0) return 100;
  return Math.round((session.totalStudyMs / total) * 100);
}

// ─── Pomodoro Timer State ────────────────────────────────────────────

export async function getPomodoro() {
  const { pomodoro } = await get('pomodoro');
  return pomodoro || null;
}

export async function savePomodoro(state) {
  await set({ pomodoro: state });
}

export async function clearPomodoro() {
  await chrome.storage.local.remove('pomodoro');
}

// ─── Settings ────────────────────────────────────────────────────────

export async function getSettings() {
  const { settings } = await get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  await set({ settings: merged });
  return merged;
}

// ─── Cleanup (remove old data) ───────────────────────────────────────

export async function cleanupOldData(daysToKeep = 30) {
  const { dailyStats } = await get('dailyStats');
  if (!dailyStats) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffKey = cutoff.toISOString().split('T')[0];

  const cleaned = {};
  for (const [key, value] of Object.entries(dailyStats)) {
    if (key >= cutoffKey) {
      cleaned[key] = value;
    }
  }

  await set({ dailyStats: cleaned });
}
