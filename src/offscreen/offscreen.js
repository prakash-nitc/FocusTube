/**
 * FocusTube — Offscreen Audio Player
 * Synthesizes the Pomodoro alarm tones with the Web Audio API (no audio files
 * to bundle). The background service worker messages this document when a
 * focus or break period ends.
 */

// Each sound is a list of [frequencyHz, startOffsetSeconds] notes.
const SOUND_PATTERNS = {
  chime: { type: 'sine',     notes: [[880, 0], [1108.73, 0.16], [1318.51, 0.32]], dur: 0.6 },
  bell:  { type: 'sine',     notes: [[660, 0], [990, 0]],                          dur: 1.4 },
  beep:  { type: 'square',   notes: [[720, 0], [720, 0.22], [720, 0.44]],          dur: 0.14 },
};

function playTone(soundName, volume) {
  const pattern = SOUND_PATTERNS[soundName] || SOUND_PATTERNS.chime;
  const vol = Math.max(0, Math.min(1, typeof volume === 'number' ? volume : 0.7));

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  let latestEnd = now;

  for (const [freq, offset] of pattern.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = pattern.type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const start = now + offset;
    const end = start + pattern.dur;
    // Quick attack, exponential decay for a pleasant, non-clipping tone.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.start(start);
    osc.stop(end + 0.03);
    latestEnd = Math.max(latestEnd, end);
  }

  // Release the audio context once playback finishes.
  const closeInMs = (latestEnd - now + 0.2) * 1000;
  setTimeout(() => ctx.close().catch(() => {}), closeInMs);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target === 'offscreen' && message.type === 'PLAY_ALARM') {
    try {
      playTone(message.sound, message.volume);
    } catch (e) {
      console.warn('[FocusTube] Alarm playback failed:', e);
    }
  }
});
