/**
 * FocusTube — Dashboard Logic
 * Renders stats, charts (Canvas API), and session history.
 */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── Initialization ───────────────────────────────────────────────

  async function init() {
    setTodayDate();
    bindNavigation();

    await Promise.all([
      loadTodayStats(),
      loadWeeklyChart(),
      loadDistractionsChart(),
      loadGoalsSummary(),
      loadHistory(),
    ]);
  }

  function setTodayDate() {
    const el = $('#today-date');
    if (el) {
      el.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  // ─── Navigation ────────────────────────────────────────────────────

  function bindNavigation() {
    $$('.sidebar__nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.sidebar__nav-item').forEach(b => b.classList.remove('sidebar__nav-item--active'));
        btn.classList.add('sidebar__nav-item--active');

        $$('.tab').forEach(t => t.classList.add('tab--hidden'));
        const tabId = `tab-${btn.dataset.tab}`;
        const tab = $(`#${tabId}`);
        if (tab) tab.classList.remove('tab--hidden');
      });
    });

    $('#settings-link')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // ─── Today's Stats ─────────────────────────────────────────────────

  async function loadTodayStats() {
    try {
      const stats = await sendMessage({ type: 'GET_DAILY_STATS' });
      if (!stats) return;

      $('#stat-study-time').textContent = formatDuration(stats.totalStudyMs || 0);
      $('#stat-distractions').textContent = stats.distractionAttempts || 0;
      $('#stat-recovered').textContent = stats.recoveredSessions || 0;

      const totalMs = (stats.totalStudyMs || 0) + (stats.totalBreakMs || 0);
      if (totalMs > 0) {
        const score = Math.round(((stats.totalStudyMs || 0) / totalMs) * 100);
        $('#stat-focus-score').textContent = score + '%';
      } else {
        $('#stat-focus-score').textContent = '—';
      }
    } catch (e) {
      console.error('[Dashboard] Error loading stats:', e);
    }
  }

  // ─── Weekly Study Chart ────────────────────────────────────────────

  async function loadWeeklyChart() {
    try {
      const weeklyData = await sendMessage({ type: 'GET_WEEKLY_STATS' });
      if (!weeklyData) return;

      const canvas = $('#weekly-chart');
      if (!canvas) return;

      drawStudyChart(canvas, weeklyData);
    } catch (e) {
      console.error('[Dashboard] Error loading weekly chart:', e);
    }
  }

  function drawStudyChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 240 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '240px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = 240;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Find max value
    const maxMs = Math.max(
      ...data.map(d => (d.totalStudyMs || 0) + (d.totalBreakMs || 0)),
      3600000 // Min 1 hour scale
    );
    const maxHours = Math.ceil(maxMs / 3600000);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH * (1 - i / 4));
      const hours = (maxHours * i / 4).toFixed(1);

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      ctx.fillText(hours + 'h', padding.left - 8, y + 4);
    }

    // Draw bars
    const barGroupWidth = chartW / data.length;
    const barWidth = Math.min(barGroupWidth * 0.5, 40);

    data.forEach((day, i) => {
      const x = padding.left + (i * barGroupWidth) + (barGroupWidth - barWidth) / 2;

      const studyH = ((day.totalStudyMs || 0) / (maxHours * 3600000)) * chartH;
      const breakH = ((day.totalBreakMs || 0) / (maxHours * 3600000)) * chartH;

      // Study bar
      const studyGrad = ctx.createLinearGradient(0, h - padding.bottom - studyH, 0, h - padding.bottom);
      studyGrad.addColorStop(0, '#8B5CF6');
      studyGrad.addColorStop(1, '#6C3CE1');

      roundRect(ctx, x, h - padding.bottom - studyH - breakH, barWidth, studyH, 4);
      ctx.fillStyle = studyGrad;
      ctx.fill();

      // Break bar (stacked on top)
      if (breakH > 1) {
        roundRect(ctx, x, h - padding.bottom - breakH, barWidth, breakH, 4);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.6)';
        ctx.fill();
      }

      // Day label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.textAlign = 'center';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.fillText(day.day, x + barWidth / 2, h - padding.bottom + 20);
    });
  }

  // ─── Distractions Chart ────────────────────────────────────────────

  async function loadDistractionsChart() {
    try {
      const weeklyData = await sendMessage({ type: 'GET_WEEKLY_STATS' });
      if (!weeklyData) return;

      const canvas = $('#distractions-chart');
      if (!canvas) return;

      drawDistractionsChart(canvas, weeklyData);
    } catch (e) {
      console.error('[Dashboard] Error loading distractions chart:', e);
    }
  }

  function drawDistractionsChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 180 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '180px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = 180;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    const maxVal = Math.max(...data.map(d => d.distractionAttempts || 0), 5);

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 3; i++) {
      const y = padding.top + (chartH * (1 - i / 3));
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.textAlign = 'right';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(Math.round(maxVal * i / 3), padding.left - 8, y + 4);
    }

    // Draw line chart
    ctx.beginPath();
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const points = [];
    data.forEach((day, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH * (1 - (day.distractionAttempts || 0) / maxVal);
      points.push({ x, y });

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Fill area under line
    ctx.lineTo(points[points.length - 1].x, h - padding.bottom);
    ctx.lineTo(points[0].x, h - padding.bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    grad.addColorStop(0, 'rgba(245, 158, 11, 0.15)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw dots
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#F59E0B';
      ctx.fill();
      ctx.strokeStyle = '#0a0814';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Day label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.textAlign = 'center';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.fillText(data[i].day, p.x, h - padding.bottom + 20);
    });
  }

  // ─── Goals Summary ─────────────────────────────────────────────────

  async function loadGoalsSummary() {
    try {
      const history = await sendMessage({ type: 'GET_SESSION_HISTORY' });
      if (!history) return;

      const withGoals = history.filter(s => s.goal);
      const completed = withGoals.filter(s => s.goalCompleted).length;
      const total = history.length;

      $('#goals-completed').textContent = completed;
      $('#goals-sessions').textContent = total;
      $('#goals-rate').textContent = withGoals.length > 0
        ? Math.round((completed / withGoals.length) * 100) + '%'
        : '—';
    } catch (e) {
      console.error('[Dashboard] Error loading goals:', e);
    }
  }

  // ─── Session History ───────────────────────────────────────────────

  async function loadHistory() {
    try {
      const history = await sendMessage({ type: 'GET_SESSION_HISTORY' });
      if (!history || history.length === 0) return;

      const container = $('#history-list');
      container.innerHTML = history.map(session => {
        const date = new Date(session.startTime).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        const duration = formatDuration(session.totalStudyMs || 0);
        const score = session.focusScore ?? '—';

        return `
          <div class="history-item">
            <div class="history-item__icon ${session.goalCompleted ? 'history-item__icon--completed' : ''}">
              ${session.goalCompleted ? '✅' : '📖'}
            </div>
            <div class="history-item__content">
              <div class="history-item__title">${escapeHtml(session.lectureTitle || 'Untitled')}</div>
              <div class="history-item__meta">${date}${session.goal ? ` · ${escapeHtml(session.goal)}` : ''}</div>
            </div>
            <div class="history-item__stats">
              <div class="history-item__stat">
                <span class="history-item__stat-value">${duration}</span>
                <span class="history-item__stat-label">Study</span>
              </div>
              <div class="history-item__stat">
                <span class="history-item__stat-value">${score}%</span>
                <span class="history-item__stat-label">Focus</span>
              </div>
              <div class="history-item__stat">
                <span class="history-item__stat-value">${session.distractionAttempts || 0}</span>
                <span class="history-item__stat-label">Distractions</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('[Dashboard] Error loading history:', e);
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '0m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h < 1) return;
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Start ─────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
