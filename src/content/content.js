/**
 * FocusTube — Main Content Script
 * Orchestrates DOM hiding, overlay injection, link interception, and SPA navigation detection.
 * Injected into all youtube.com pages.
 */

(() => {
  'use strict';

  // ─── Constants (duplicated to avoid import issues in content scripts) ──

  const RESTRICTED_PATTERNS = [
    { name: 'Home',          test: (url) => /^https?:\/\/(www\.)?youtube\.com\/?(\?.*)?$/.test(url) },
    { name: 'Home Feed',     test: (url) => /^https?:\/\/(www\.)?youtube\.com\/feed\/?(\?.*)?$/.test(url) },
    { name: 'Shorts',        test: (url) => /^https?:\/\/(www\.)?youtube\.com\/shorts\//.test(url) },
    { name: 'Trending',      test: (url) => /^https?:\/\/(www\.)?youtube\.com\/feed\/trending/.test(url) },
    { name: 'Explore',       test: (url) => /^https?:\/\/(www\.)?youtube\.com\/feed\/explore/.test(url) },
    { name: 'Subscriptions', test: (url) => /^https?:\/\/(www\.)?youtube\.com\/feed\/subscriptions/.test(url) },
    { name: 'Gaming',        test: (url) => /^https?:\/\/(www\.)?youtube\.com\/gaming/.test(url) },
    { name: 'Movies',        test: (url) => /^https?:\/\/(www\.)?youtube\.com\/feed\/storefront/.test(url) },
    { name: 'Music',         test: (url) => /^https?:\/\/(www\.)?youtube\.com\/music/.test(url) },
  ];

  const MSG = {
    GET_STATUS: 'GET_STATUS',
    SESSION_UPDATED: 'SESSION_UPDATED',
    PAGE_CHANGED: 'PAGE_CHANGED',
    LOG_DISTRACTION: 'LOG_DISTRACTION',
    LOG_RECOVERY: 'LOG_RECOVERY',
    NAVIGATE_TO_LECTURE: 'NAVIGATE_TO_LECTURE',
    START_BREAK: 'START_BREAK',
    END_BREAK: 'END_BREAK',
  };

  // ─── State ─────────────────────────────────────────────────────────

  let currentSession = null;
  let isStudyModeActive = false;
  let observer = null;
  let linkInterceptActive = false;
  let lastUrl = location.href;
  let settings = {};

  // Maps each "Hide …" setting to the body class that activates its CSS rule.
  const HIDE_CLASS_MAP = {
    hideSidebar:         'focustube-hide-sidebar',
    hideRecommendations: 'focustube-hide-recommendations',
    hideShorts:          'focustube-hide-shorts',
    hideComments:        'focustube-hide-comments',
    hideEndCards:        'focustube-hide-endcards',
  };

  // ─── Initialization ───────────────────────────────────────────────

  async function init() {
    // Get current session status
    try {
      const status = await sendMessage({ type: MSG.GET_STATUS });
      if (status?.active && status.session) {
        currentSession = status.session;
        isStudyModeActive = true;
        activateStudyMode();
      }
    } catch (e) {
      console.log('[FocusTube] No active session.');
    }

    // Listen for messages from background
    chrome.runtime.onMessage.addListener(handleMessage);

    // Re-apply hiding instantly when settings change in the options page
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        settings = changes.settings.newValue || {};
        applyHideClasses();
      }
    });

    // Listen for YouTube SPA navigation
    listenForNavigation();
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get('settings');
      settings = stored.settings || {};
    } catch {
      settings = {};
    }
  }

  // Toggle a body class per "Hide …" setting (defaults to hidden when unset).
  function applyHideClasses() {
    const body = document.body;
    if (!body) return;
    for (const [setting, cls] of Object.entries(HIDE_CLASS_MAP)) {
      const enabled = isStudyModeActive && settings[setting] !== false;
      body.classList.toggle(cls, enabled);
    }
  }

  // ─── Message Handling ──────────────────────────────────────────────

  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case MSG.SESSION_UPDATED:
        handleSessionUpdate(message.data);
        sendResponse({ ok: true });
        break;

      case MSG.PAGE_CHANGED:
        handlePageChange(message.data);
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: true });
    }
  }

  function handleSessionUpdate(session) {
    currentSession = session;

    if (session && session.state !== 'ended') {
      isStudyModeActive = true;
      activateStudyMode();
    } else {
      isStudyModeActive = false;
      deactivateStudyMode();
    }
  }

  function handlePageChange(data) {
    if (!isStudyModeActive) return;
    evaluatePage(data?.url || location.href);
  }

  // ─── Study Mode Activation ────────────────────────────────────────

  async function activateStudyMode() {
    await loadSettings();
    document.body.classList.add('focustube-active');
    applyHideClasses();
    startMutationObserver();
    startLinkInterception();
    evaluatePage(location.href);
  }

  function deactivateStudyMode() {
    document.body.classList.remove('focustube-active');
    Object.values(HIDE_CLASS_MAP).forEach(cls => document.body.classList.remove(cls));
    stopMutationObserver();
    stopLinkInterception();
    window.FocusTubeOverlay?.remove();
    window.FocusTubeModal?.remove();
  }

  // ─── Page Evaluation ───────────────────────────────────────────────

  function evaluatePage(url) {
    if (!isStudyModeActive || !currentSession) return;

    // Check if emergency unlocked
    if (currentSession.emergencyUnlockUntil && Date.now() < currentSession.emergencyUnlockUntil) {
      window.FocusTubeOverlay?.remove();
      return;
    }

    // Check if page is restricted
    const restrictedPage = getRestrictedPageName(url);
    if (restrictedPage) {
      window.FocusTubeOverlay?.create(currentSession, { pageName: restrictedPage });
      return;
    }

    // If on a watch page, remove overlay
    if (isWatchPage(url)) {
      window.FocusTubeOverlay?.remove();
    }
  }

  function getRestrictedPageName(url) {
    for (const { name, test } of RESTRICTED_PATTERNS) {
      if (test(url)) return name;
    }
    return null;
  }

  function isWatchPage(url) {
    return /youtube\.com\/watch\?/.test(url);
  }

  // ─── MutationObserver (re-hide dynamically rendered elements) ──────

  function startMutationObserver() {
    if (observer) return;

    // Watch only the body's class attribute — far cheaper than observing the
    // whole subtree, and it directly catches YouTube wiping our classes.
    observer = new MutationObserver(() => {
      if (isStudyModeActive && !document.body.classList.contains('focustube-active')) {
        document.body.classList.add('focustube-active');
        applyHideClasses();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function stopMutationObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ─── Link Interception ────────────────────────────────────────────

  function startLinkInterception() {
    if (linkInterceptActive) return;
    linkInterceptActive = true;

    document.addEventListener('click', handleLinkClick, true);
  }

  function stopLinkInterception() {
    linkInterceptActive = false;
    document.removeEventListener('click', handleLinkClick, true);
  }

  function handleLinkClick(event) {
    if (!isStudyModeActive || !currentSession) return;

    // Check if emergency unlocked
    if (currentSession.emergencyUnlockUntil && Date.now() < currentSession.emergencyUnlockUntil) {
      return;
    }

    // Find the closest link element
    const link = event.target.closest('a[href]');
    if (!link) return;

    const href = link.href;
    if (!href) return;

    // Only intercept YouTube watch links
    if (!isWatchPage(href)) return;

    // Check if it's the current lecture
    const currentVideoId = getVideoId(currentSession.lectureUrl);
    const destVideoId = getVideoId(href);

    if (currentVideoId && destVideoId && currentVideoId === destVideoId) {
      return; // Same video, allow
    }

    // Get destination video title from DOM
    const titleEl = link.querySelector('#video-title') ||
                    link.querySelector('.title') ||
                    link.querySelector('yt-formatted-string') ||
                    link;
    const destTitle = titleEl?.textContent?.trim() || titleEl?.getAttribute('title') || '';

    if (!destTitle) return; // Can't determine title, allow

    // Check relevance
    const relevance = window.FocusTubeRelevance?.checkRelevance(
      currentSession.lectureTitle,
      destTitle,
      currentSession.keywords || []
    );

    if (relevance && relevance.verdict === 'RELATED') {
      return; // Allow clearly related content in any mode
    }

    // Intercept — prevent default and show modal
    event.preventDefault();
    event.stopPropagation();

    // Strict mode removes the "Continue Anyway" escape hatch.
    const strict = settings.strictnessLevel === 'strict';

    window.FocusTubeModal?.showIntentModal(
      currentSession,
      destTitle,
      href,
      relevance,
      strict
    ).then(action => {
      if (action === 'continue') {
        // User chose to continue — navigate manually
        window.location.href = href;
      }
    });
  }

  function getVideoId(url) {
    if (!url) return null;
    try {
      return new URL(url).searchParams.get('v');
    } catch {
      return null;
    }
  }

  // ─── YouTube SPA Navigation Detection ──────────────────────────────

  function listenForNavigation() {
    // YouTube fires this custom event on SPA navigation
    document.addEventListener('yt-navigate-finish', () => {
      const newUrl = location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        if (isStudyModeActive) {
          evaluatePage(newUrl);
        }
      }
    });

    // Also listen for popstate (back/forward)
    window.addEventListener('popstate', () => {
      const newUrl = location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        if (isStudyModeActive) {
          evaluatePage(newUrl);
        }
      }
    });
  }

  // ─── Helper: Send message to background ────────────────────────────

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ─── Start ─────────────────────────────────────────────────────────

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
