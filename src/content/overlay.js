/**
 * FocusTube — Focus Overlay
 * Replaces YouTube homepage/restricted pages with a clean study dashboard.
 */

const FocusTubeOverlay = (() => {

  const OVERLAY_ID = 'focustube-overlay';

  function create(session, pageInfo) {
    remove(); // Remove existing overlay if any

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = buildOverlayHTML(session, pageInfo);
    document.body.appendChild(overlay);

    // Bind events after insertion
    bindEvents(overlay, session);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('focustube-overlay--visible');
    });
  }

  function remove() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      existing.classList.remove('focustube-overlay--visible');
      setTimeout(() => existing.remove(), 300);
    }
  }

  function isVisible() {
    return !!document.getElementById(OVERLAY_ID);
  }

  function buildOverlayHTML(session, pageInfo) {
    const studyMs = session
      ? session.totalStudyMs + (session.state === 'active' && session.counting ? Date.now() - session.lastActiveTimestamp : 0)
      : 0;
    const studyTime = formatDurationOverlay(studyMs);
    const focusScore = session
      ? calculateFocusScoreOverlay(session.totalStudyMs, session.totalStudyMs + session.totalBreakMs)
      : 100;

    const pageName = pageInfo?.pageName || 'Restricted Page';
    const isBreak = session?.state === 'break';

    if (isBreak) {
      return buildBreakOverlayHTML(session);
    }

    return `
      <div class="focustube-overlay__backdrop"></div>
      <div class="focustube-overlay__container">
        <div class="focustube-overlay__glow"></div>
        <div class="focustube-overlay__card">

          <div class="focustube-overlay__header">
            <div class="focustube-overlay__logo">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <defs>
                  <linearGradient id="ft-grad" x1="0" y1="0" x2="32" y2="32">
                    <stop offset="0%" stop-color="#6C3CE1"/>
                    <stop offset="100%" stop-color="#00B4D8"/>
                  </linearGradient>
                </defs>
                <rect rx="8" width="32" height="32" fill="url(#ft-grad)"/>
                <polygon points="13,10 13,22 23,16" fill="white"/>
              </svg>
              <span>FocusTube</span>
            </div>
            <div class="focustube-overlay__badge">
              <span class="focustube-overlay__badge-dot"></span>
              Study Mode Active
            </div>
          </div>

          <div class="focustube-overlay__blocked-notice">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L13.9 15.31A7.93 7.93 0 0110 18zm6.31-3.1L6.1 4.69A7.93 7.93 0 0110 2c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>
            </svg>
            <span><strong>${pageName}</strong> is restricted during your study session</span>
          </div>

          <div class="focustube-overlay__session-info">
            <h2 class="focustube-overlay__title">Current Session</h2>
            <p class="focustube-overlay__lecture-name">${escapeHtml(session?.lectureTitle || 'No active lecture')}</p>

            ${session?.goal ? `
              <div class="focustube-overlay__goal">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 6.2l-4 4a.7.7 0 01-1 0l-2-2a.7.7 0 011-1L7 8.7l3.5-3.5a.7.7 0 011 1z"/>
                </svg>
                <span>${escapeHtml(session.goal)}</span>
              </div>
            ` : ''}
          </div>

          <div class="focustube-overlay__stats">
            <div class="focustube-overlay__stat">
              <span class="focustube-overlay__stat-value">${studyTime}</span>
              <span class="focustube-overlay__stat-label">Time Studied</span>
            </div>
            <div class="focustube-overlay__stat">
              <span class="focustube-overlay__stat-value">${focusScore}%</span>
              <span class="focustube-overlay__stat-label">Focus Score</span>
            </div>
            <div class="focustube-overlay__stat">
              <span class="focustube-overlay__stat-value">${session?.distractionAttempts || 0}</span>
              <span class="focustube-overlay__stat-label">Distractions</span>
            </div>
          </div>

          <div class="focustube-overlay__actions">
            <button class="focustube-overlay__btn focustube-overlay__btn--primary" id="focustube-resume-btn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <polygon points="4,2 4,14 14,8"/>
              </svg>
              Resume Lecture
            </button>
            <button class="focustube-overlay__btn focustube-overlay__btn--secondary" id="focustube-end-btn">
              End Session
            </button>
          </div>

        </div>
      </div>
    `;
  }

  function buildBreakOverlayHTML(session) {
    const breakRemaining = session.breakEndTime
      ? Math.max(0, session.breakEndTime - Date.now())
      : 0;

    return `
      <div class="focustube-overlay__backdrop focustube-overlay__backdrop--break"></div>
      <div class="focustube-overlay__container">
        <div class="focustube-overlay__glow focustube-overlay__glow--break"></div>
        <div class="focustube-overlay__card">

          <div class="focustube-overlay__header">
            <div class="focustube-overlay__logo">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <defs>
                  <linearGradient id="ft-grad-brk" x1="0" y1="0" x2="32" y2="32">
                    <stop offset="0%" stop-color="#F59E0B"/>
                    <stop offset="100%" stop-color="#EF4444"/>
                  </linearGradient>
                </defs>
                <rect rx="8" width="32" height="32" fill="url(#ft-grad-brk)"/>
                <text x="16" y="22" text-anchor="middle" fill="white" font-size="18">☕</text>
              </svg>
              <span>FocusTube</span>
            </div>
            <div class="focustube-overlay__badge focustube-overlay__badge--break">
              <span class="focustube-overlay__badge-dot focustube-overlay__badge-dot--break"></span>
              Break Mode
            </div>
          </div>

          <div class="focustube-overlay__break-info">
            <h2 class="focustube-overlay__title">Take a Breather ☕</h2>
            <p class="focustube-overlay__break-timer" id="focustube-break-timer">
              ${formatTimerOverlay(breakRemaining)}
            </p>
            <p class="focustube-overlay__break-subtitle">remaining</p>
          </div>

          <div class="focustube-overlay__actions">
            <button class="focustube-overlay__btn focustube-overlay__btn--primary" id="focustube-end-break-btn">
              End Break Early
            </button>
          </div>

        </div>
      </div>
    `;
  }

  function bindEvents(overlay, session) {
    const resumeBtn = overlay.querySelector('#focustube-resume-btn');
    const endBtn = overlay.querySelector('#focustube-end-btn');
    const endBreakBtn = overlay.querySelector('#focustube-end-break-btn');

    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_LECTURE' });
      });
    }

    if (endBtn) {
      endBtn.addEventListener('click', () => {
        // Show goal completion prompt
        showGoalCompletionPrompt(overlay, session);
      });
    }

    if (endBreakBtn) {
      endBreakBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'END_BREAK' });
      });
    }

    // Update break timer if on break
    if (session?.state === 'break' && session.breakEndTime) {
      startBreakTimerUpdate(overlay, session);
    }
  }

  function showGoalCompletionPrompt(overlay, session) {
    const card = overlay.querySelector('.focustube-overlay__card');
    if (!card) return;

    card.innerHTML = `
      <div class="focustube-overlay__header">
        <div class="focustube-overlay__logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <defs>
              <linearGradient id="ft-grad-end" x1="0" y1="0" x2="32" y2="32">
                <stop offset="0%" stop-color="#6C3CE1"/>
                <stop offset="100%" stop-color="#00B4D8"/>
              </linearGradient>
            </defs>
            <rect rx="8" width="32" height="32" fill="url(#ft-grad-end)"/>
            <polygon points="13,10 13,22 23,16" fill="white"/>
          </svg>
          <span>FocusTube</span>
        </div>
      </div>

      <div class="focustube-overlay__session-info">
        <h2 class="focustube-overlay__title">End Session</h2>
        ${session?.goal ? `
          <p class="focustube-overlay__lecture-name">Did you complete your goal?</p>
          <p class="focustube-overlay__goal-text">"${escapeHtml(session.goal)}"</p>
        ` : '<p class="focustube-overlay__lecture-name">Are you sure you want to end this session?</p>'}
      </div>

      <div class="focustube-overlay__actions focustube-overlay__actions--vertical">
        ${session?.goal ? `
          <button class="focustube-overlay__btn focustube-overlay__btn--success" id="focustube-goal-yes">
            ✅ Yes, I completed it!
          </button>
          <button class="focustube-overlay__btn focustube-overlay__btn--secondary" id="focustube-goal-no">
            Not yet, but ending anyway
          </button>
        ` : `
          <button class="focustube-overlay__btn focustube-overlay__btn--primary" id="focustube-goal-no">
            End Session
          </button>
        `}
        <button class="focustube-overlay__btn focustube-overlay__btn--ghost" id="focustube-goal-cancel">
          ← Go Back
        </button>
      </div>
    `;

    // Rebind
    const yesBtn = card.querySelector('#focustube-goal-yes');
    const noBtn = card.querySelector('#focustube-goal-no');
    const cancelBtn = card.querySelector('#focustube-goal-cancel');

    if (yesBtn) {
      yesBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'END_SESSION', data: { goalCompleted: true } });
        remove();
      });
    }

    if (noBtn) {
      noBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'END_SESSION', data: { goalCompleted: false } });
        remove();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        // Rebuild the main overlay
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
          if (response?.session) {
            create(response.session, { pageName: 'This Page' });
          }
        });
      });
    }
  }

  function startBreakTimerUpdate(overlay, session) {
    const timerEl = overlay.querySelector('#focustube-break-timer');
    if (!timerEl) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, session.breakEndTime - Date.now());
      timerEl.textContent = formatTimerOverlay(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
  }

  // ─── Formatting helpers (self-contained, no imports) ──────────

  function formatDurationOverlay(ms) {
    if (!ms || ms < 0) return '0m';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatTimerOverlay(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function calculateFocusScoreOverlay(studyMs, totalMs) {
    if (!totalMs || totalMs === 0) return 100;
    return Math.round((studyMs / totalMs) * 100);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { create, remove, isVisible };

})();

window.FocusTubeOverlay = FocusTubeOverlay;
