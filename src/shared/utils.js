/**
 * FocusTube — Shared Utilities
 */

import { RESTRICTED_URL_PATTERNS, PAGE_TYPES, STOP_WORDS } from './constants.js';

// ─── UUID Generation ─────────────────────────────────────────────────

export function generateUUID() {
  return crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

// ─── Duration Formatting ─────────────────────────────────────────────

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function formatDurationLong(ms) {
  if (!ms || ms < 0) return '0 minutes';

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

  return parts.join(' ') || '0 minutes';
}

export function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = n => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

// ─── URL Utilities ───────────────────────────────────────────────────

export function isYouTubeVideoUrl(url) {
  if (!url) return false;
  return /^https?:\/\/(www\.)?youtube\.com\/watch\?/.test(url);
}

export function getVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

export function getPageType(url) {
  if (!url) return PAGE_TYPES.OTHER;

  if (isYouTubeVideoUrl(url)) return PAGE_TYPES.WATCH;

  for (const { name, pattern } of RESTRICTED_URL_PATTERNS) {
    if (pattern.test(url)) {
      if (name === 'Shorts') return PAGE_TYPES.SHORTS;
      return PAGE_TYPES.RESTRICTED;
    }
  }

  if (/youtube\.com\/results/.test(url)) return PAGE_TYPES.SEARCH;
  if (/youtube\.com\/(c\/|channel\/|@)/.test(url)) return PAGE_TYPES.CHANNEL;
  if (/youtube\.com\/playlist/.test(url)) return PAGE_TYPES.PLAYLIST;

  return PAGE_TYPES.OTHER;
}

export function getRestrictedPageName(url) {
  if (!url) return null;
  for (const { name, pattern } of RESTRICTED_URL_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return null;
}

// ─── Focus Score ─────────────────────────────────────────────────────

export function calculateFocusScore(studyMs, totalMs) {
  if (!totalMs || totalMs === 0) return 100;
  return Math.round((studyMs / totalMs) * 100);
}

// ─── Keyword Extraction ──────────────────────────────────────────────

export function extractKeywords(text) {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\+\#\.]/g, ' ')   // keep #, +, . for tech terms
    .split(/\s+/)
    .map(w => w.replace(/^[.\-]+|[.\-]+$/g, '')) // trim dots/dashes
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// ─── Debounce ────────────────────────────────────────────────────────

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── Throttle ────────────────────────────────────────────────────────

export function throttle(fn, limit = 300) {
  let inThrottle = false;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
