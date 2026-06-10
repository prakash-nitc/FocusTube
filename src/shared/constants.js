/**
 * FocusTube — Shared Constants
 * Single source of truth for all configuration values.
 */

// ─── Restricted YouTube URL Patterns ─────────────────────────────────
// These patterns match YouTube pages that should be blocked during study sessions.
export const RESTRICTED_URL_PATTERNS = [
  { name: 'Home',          pattern: /^https?:\/\/(www\.)?youtube\.com\/?(\?.*)?$/i },
  { name: 'Home Feed',     pattern: /^https?:\/\/(www\.)?youtube\.com\/feed\/?(\?.*)?$/i },
  { name: 'Shorts',        pattern: /^https?:\/\/(www\.)?youtube\.com\/shorts\//i },
  { name: 'Trending',      pattern: /^https?:\/\/(www\.)?youtube\.com\/feed\/trending/i },
  { name: 'Explore',       pattern: /^https?:\/\/(www\.)?youtube\.com\/feed\/explore/i },
  { name: 'Subscriptions', pattern: /^https?:\/\/(www\.)?youtube\.com\/feed\/subscriptions/i },
  { name: 'Gaming',        pattern: /^https?:\/\/(www\.)?youtube\.com\/gaming/i },
  { name: 'Movies',        pattern: /^https?:\/\/(www\.)?youtube\.com\/feed\/storefront/i },
  { name: 'Music',         pattern: /^https?:\/\/(www\.)?youtube\.com\/music/i },
];

// ─── YouTube Page Types ──────────────────────────────────────────────
export const PAGE_TYPES = {
  HOME: 'home',
  WATCH: 'watch',
  SHORTS: 'shorts',
  SEARCH: 'search',
  CHANNEL: 'channel',
  PLAYLIST: 'playlist',
  RESTRICTED: 'restricted',
  OTHER: 'other',
};

// ─── CSS Selectors for Distracting Elements ──────────────────────────
export const DISTRACTING_SELECTORS = {
  sidebar:              '#guide',
  sidebarMini:          'ytd-mini-guide-renderer',
  recommendations:      '#secondary',
  relatedVideos:        '#related',
  shortsShelf:          'ytd-reel-shelf-renderer',
  richShortsShelf:      'ytd-rich-shelf-renderer[is-shorts]',
  comments:             '#comments',
  endScreenCards:       '.ytp-ce-element',
  homeFeed:             'ytd-rich-grid-renderer',
  trendingShelf:        'ytd-shelf-renderer',
  chipBar:              '#chip-bar',         // Category filter chips on home
  masthead:             '#masthead',         // Will NOT hide, but may modify
};

// ─── Session States ──────────────────────────────────────────────────
export const SESSION_STATES = {
  ACTIVE: 'active',
  BREAK: 'break',
  PAUSED: 'paused',
  ENDED: 'ended',
};

// ─── Alarm Names ─────────────────────────────────────────────────────
export const ALARM_NAMES = {
  BREAK_END: 'focustube-break-end',
  POMODORO_PHASE: 'focustube-pomodoro-phase',
  DISTRACTION_CHECK: 'focustube-distraction-check',
  EMERGENCY_UNLOCK_END: 'focustube-emergency-unlock-end',
  SESSION_TICK: 'focustube-session-tick',
};

// ─── Pomodoro Phases ─────────────────────────────────────────────────
export const POMODORO_PHASES = {
  FOCUS: 'focus',
  SHORT_BREAK: 'shortBreak',
  LONG_BREAK: 'longBreak',
};

export const POMODORO_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
};

// ─── Message Types ───────────────────────────────────────────────────
export const MSG = {
  START_SESSION: 'START_SESSION',
  END_SESSION: 'END_SESSION',
  GET_STATUS: 'GET_STATUS',
  START_BREAK: 'START_BREAK',
  END_BREAK: 'END_BREAK',
  EMERGENCY_UNLOCK: 'EMERGENCY_UNLOCK',
  LOG_DISTRACTION: 'LOG_DISTRACTION',
  LOG_RECOVERY: 'LOG_RECOVERY',
  NAVIGATE_TO_LECTURE: 'NAVIGATE_TO_LECTURE',
  SESSION_UPDATED: 'SESSION_UPDATED',
  PAGE_CHANGED: 'PAGE_CHANGED',
  CHECK_RELEVANCE: 'CHECK_RELEVANCE',
  UPDATE_GOAL: 'UPDATE_GOAL',
  COMPLETE_GOAL: 'COMPLETE_GOAL',
  GET_DAILY_STATS: 'GET_DAILY_STATS',
  GET_WEEKLY_STATS: 'GET_WEEKLY_STATS',
  GET_SESSION_HISTORY: 'GET_SESSION_HISTORY',
  OPEN_DASHBOARD: 'OPEN_DASHBOARD',
  // Standalone Pomodoro timer
  POMODORO_START: 'POMODORO_START',
  POMODORO_PAUSE: 'POMODORO_PAUSE',
  POMODORO_RESUME: 'POMODORO_RESUME',
  POMODORO_RESET: 'POMODORO_RESET',
  POMODORO_SKIP: 'POMODORO_SKIP',
  POMODORO_GET: 'POMODORO_GET',
  POMODORO_UPDATED: 'POMODORO_UPDATED',
};

// ─── Default Settings ────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  allowedDomains: [
    'youtube.com',
    'leetcode.com',
    'chatgpt.com',
    'developer.mozilla.org',
    'google.com',
    'stackoverflow.com',
    'github.com',
  ],
  breakDurations: [5, 10, 15],

  // ── Pomodoro (standalone timer) ──
  pomodoroFocusMinutes: 25,
  pomodoroShortBreakMinutes: 5,
  pomodoroLongBreakMinutes: 15,
  pomodoroCyclesBeforeLongBreak: 4,
  pomodoroAutoStartNext: true,     // auto-start the next phase when one ends
  pomodoroAlarmSound: 'chime',     // 'chime' | 'bell' | 'beep' | 'none'
  pomodoroAlarmVolume: 0.7,        // 0..1
  pomodoroPresets: {
    '25/5':  { focus: 25, shortBreak: 5,  longBreak: 15 },
    '50/10': { focus: 50, shortBreak: 10, longBreak: 20 },
    '90/15': { focus: 90, shortBreak: 15, longBreak: 30 },
  },

  // ── Floating clock overlay ──
  floatingClockEnabled: false,
  floatingClockPosition: { right: 24, bottom: 24 },

  strictnessLevel: 'standard', // 'standard' | 'strict'
  hideComments: true,
  hideSidebar: true,
  hideRecommendations: true,
  hideShorts: true,
  hideEndCards: true,
  recoveryReminderMinutes: 15,
  emergencyUnlockPhrase: 'I choose to pause my study session',
  emergencyUnlockDurationMinutes: 10,
};

// ─── Relevance Thresholds ────────────────────────────────────────────
export const RELEVANCE = {
  RELATED: 'RELATED',
  PARTIALLY_RELATED: 'PARTIALLY_RELATED',
  UNRELATED: 'UNRELATED',
  THRESHOLD_RELATED: 0.3,
  THRESHOLD_PARTIAL: 0.1,
};

// ─── Stop Words (for keyword extraction) ─────────────────────────────
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'are', 'was',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
  'just', 'about', 'above', 'after', 'again', 'all', 'also', 'am',
  'any', 'as', 'because', 'before', 'between', 'both', 'each', 'few',
  'get', 'got', 'here', 'how', 'i', 'into', 'its', 'let', 'like',
  'make', 'me', 'more', 'most', 'much', 'my', 'no', 'now', 'only',
  'other', 'our', 'out', 'own', 'same', 'she', 'he', 'some', 'such',
  'take', 'their', 'them', 'these', 'they', 'those', 'through', 'under',
  'until', 'up', 'us', 'want', 'we', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'you', 'your',
  // YouTube-specific stop words
  'video', 'tutorial', 'lecture', 'part', 'episode', 'ep', 'full',
  'course', 'class', 'lesson', 'chapter', 'series', 'complete',
  'beginner', 'advanced', 'intermediate', 'introduction', 'intro',
  'hindi', 'english', 'explained', 'explanation', 'learn', 'learning',
  'guide', 'tips', 'tricks', 'how', 'easy', 'simple', 'best', 'top',
  'new', 'latest', 'updated', '2024', '2025', '2026',
]);
