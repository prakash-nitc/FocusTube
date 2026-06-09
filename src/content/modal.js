/**
 * FocusTube — Intent Confirmation Modal
 * Shown when a user clicks on a video that appears unrelated to their study topic.
 */

const FocusTubeModal = (() => {

  const MODAL_ID = 'focustube-modal';
  let emergencyUnlockCallback = null;

  function showIntentModal(session, destinationTitle, destinationUrl, relevanceResult, strict = false) {
    remove(); // Remove any existing modal

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = buildIntentModalHTML(session, destinationTitle, relevanceResult, strict);
    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => {
      modal.classList.add('focustube-modal--visible');
    });

    return new Promise((resolve) => {
      bindIntentEvents(modal, destinationUrl, resolve);
    });
  }

  function showEmergencyUnlockModal() {
    remove();

    return new Promise((resolve) => {
      chrome.storage.local.get('settings', ({ settings }) => {
        const phrase = settings?.emergencyUnlockPhrase || 'I choose to pause my study session';
        const duration = settings?.emergencyUnlockDurationMinutes || 10;

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.innerHTML = buildEmergencyUnlockHTML(phrase, duration);
        document.body.appendChild(modal);

        requestAnimationFrame(() => {
          modal.classList.add('focustube-modal--visible');
        });

        bindEmergencyEvents(modal, phrase, resolve);
      });
    });
  }

  function remove() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
      existing.classList.remove('focustube-modal--visible');
      setTimeout(() => existing.remove(), 300);
    }
  }

  function buildIntentModalHTML(session, destinationTitle, relevanceResult, strict = false) {
    const score = relevanceResult?.score || 0;
    const verdict = relevanceResult?.verdict || 'UNRELATED';
    const isPartial = verdict === 'PARTIALLY_RELATED';

    const warningColor = isPartial ? '#F59E0B' : '#EF4444';
    const warningIcon = isPartial
      ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="${warningColor}">
           <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
         </svg>`
      : `<svg width="24" height="24" viewBox="0 0 24 24" fill="${warningColor}">
           <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L15.9 17.31A7.93 7.93 0 0112 20zm6.31-3.1L8.1 6.69A7.93 7.93 0 0112 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>
         </svg>`;

    return `
      <div class="focustube-modal__backdrop" id="focustube-modal-backdrop"></div>
      <div class="focustube-modal__container">
        <div class="focustube-modal__card">

          <div class="focustube-modal__icon" style="color: ${warningColor}">
            ${warningIcon}
          </div>

          <h2 class="focustube-modal__title">
            ${isPartial ? 'This video may be off-topic' : 'This video appears unrelated'}
          </h2>

          <div class="focustube-modal__comparison">
            <div class="focustube-modal__topic">
              <span class="focustube-modal__topic-label">Current Topic</span>
              <span class="focustube-modal__topic-value">${escapeHtml(session?.lectureTitle || 'Your Study Session')}</span>
            </div>
            <div class="focustube-modal__divider">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="#666">
                <path d="M10 2l8 8-8 8-1.4-1.4L14.2 11H2V9h12.2L8.6 3.4z"/>
              </svg>
            </div>
            <div class="focustube-modal__topic">
              <span class="focustube-modal__topic-label">Destination</span>
              <span class="focustube-modal__topic-value focustube-modal__topic-value--dest">${escapeHtml(destinationTitle)}</span>
            </div>
          </div>

          <div class="focustube-modal__relevance-bar">
            <div class="focustube-modal__relevance-fill" style="width: ${Math.round(score * 100)}%; background: ${warningColor}"></div>
          </div>
          <p class="focustube-modal__relevance-text">Relevance: ${Math.round(score * 100)}%</p>

          <div class="focustube-modal__actions">
            <button class="focustube-modal__btn focustube-modal__btn--primary" id="focustube-modal-study">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <polygon points="4,2 4,14 14,8"/>
              </svg>
              Return to Study
            </button>
            <button class="focustube-modal__btn focustube-modal__btn--break" id="focustube-modal-break">
              ☕ Take a Break
            </button>
            ${strict ? `
              <p class="focustube-modal__relevance-text">Strict mode is on — unrelated videos are blocked.</p>
            ` : `
              <button class="focustube-modal__btn focustube-modal__btn--ghost" id="focustube-modal-continue">
                Continue Anyway
              </button>
            `}
          </div>

        </div>
      </div>
    `;
  }

  function buildEmergencyUnlockHTML(phrase, duration) {
    return `
      <div class="focustube-modal__backdrop" id="focustube-modal-backdrop"></div>
      <div class="focustube-modal__container">
        <div class="focustube-modal__card">

          <div class="focustube-modal__icon" style="color: #EF4444">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          </div>

          <h2 class="focustube-modal__title">Emergency Unlock</h2>
          <p class="focustube-modal__subtitle">
            This will temporarily disable FocusTube protections for ${duration} minutes.
            Type the phrase below to confirm:
          </p>

          <div class="focustube-modal__unlock-phrase">
            <p class="focustube-modal__phrase-text">${escapeHtml(phrase)}</p>
          </div>

          <div class="focustube-modal__input-wrapper">
            <input
              type="text"
              class="focustube-modal__input"
              id="focustube-unlock-input"
              placeholder="Type the phrase above..."
              autocomplete="off"
              spellcheck="false"
            />
          </div>

          <div class="focustube-modal__actions">
            <button class="focustube-modal__btn focustube-modal__btn--danger" id="focustube-unlock-confirm" disabled>
              🔓 Unlock for ${duration} Minutes
            </button>
            <button class="focustube-modal__btn focustube-modal__btn--ghost" id="focustube-unlock-cancel">
              Cancel
            </button>
          </div>

        </div>
      </div>
    `;
  }

  function bindIntentEvents(modal, destinationUrl, resolve) {
    const studyBtn = modal.querySelector('#focustube-modal-study');
    const breakBtn = modal.querySelector('#focustube-modal-break');
    const continueBtn = modal.querySelector('#focustube-modal-continue');
    const backdrop = modal.querySelector('#focustube-modal-backdrop');

    studyBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_LECTURE' });
      remove();
      resolve('study');
    });

    breakBtn?.addEventListener('click', () => {
      // Show break duration picker
      showBreakPicker(modal, resolve);
    });

    continueBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'LOG_DISTRACTION' });
      remove();
      resolve('continue');
    });

    backdrop?.addEventListener('click', () => {
      remove();
      resolve('dismissed');
    });
  }

  function showBreakPicker(modal, resolve) {
    const card = modal.querySelector('.focustube-modal__card');
    if (!card) return;

    card.innerHTML = `
      <h2 class="focustube-modal__title">Take a Break ☕</h2>
      <p class="focustube-modal__subtitle">How long would you like to rest?</p>

      <div class="focustube-modal__break-options">
        <button class="focustube-modal__break-btn" data-minutes="5">5 min</button>
        <button class="focustube-modal__break-btn" data-minutes="10">10 min</button>
        <button class="focustube-modal__break-btn" data-minutes="15">15 min</button>
      </div>

      <div class="focustube-modal__actions">
        <button class="focustube-modal__btn focustube-modal__btn--ghost" id="focustube-break-cancel">
          Cancel
        </button>
      </div>
    `;

    card.querySelectorAll('.focustube-modal__break-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const minutes = parseInt(btn.dataset.minutes, 10);
        chrome.runtime.sendMessage({ type: 'START_BREAK', data: { minutes } });
        remove();
        resolve('break');
      });
    });

    card.querySelector('#focustube-break-cancel')?.addEventListener('click', () => {
      remove();
      resolve('dismissed');
    });
  }

  function bindEmergencyEvents(modal, phrase, resolve) {
    const input = modal.querySelector('#focustube-unlock-input');
    const confirmBtn = modal.querySelector('#focustube-unlock-confirm');
    const cancelBtn = modal.querySelector('#focustube-unlock-cancel');
    const backdrop = modal.querySelector('#focustube-modal-backdrop');

    const targetPhrase = phrase.trim().toLowerCase();

    input?.addEventListener('input', () => {
      const matches = input.value.trim().toLowerCase() === targetPhrase;
      confirmBtn.disabled = !matches;
      if (matches) {
        confirmBtn.classList.add('focustube-modal__btn--ready');
      } else {
        confirmBtn.classList.remove('focustube-modal__btn--ready');
      }
    });

    confirmBtn?.addEventListener('click', () => {
      if (!confirmBtn.disabled) {
        chrome.runtime.sendMessage({ type: 'EMERGENCY_UNLOCK' });
        remove();
        resolve('unlocked');
      }
    });

    cancelBtn?.addEventListener('click', () => {
      remove();
      resolve('cancelled');
    });

    backdrop?.addEventListener('click', () => {
      remove();
      resolve('cancelled');
    });

    // Focus the input
    setTimeout(() => input?.focus(), 100);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { showIntentModal, showEmergencyUnlockModal, remove };

})();

window.FocusTubeModal = FocusTubeModal;
