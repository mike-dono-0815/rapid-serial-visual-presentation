'use strict';

// ─── Default text ─────────────────────────────────────────────────────────────
// Only English letters, digits, dots and spaces — no commas, dashes or symbols.
const DEFAULT_TEXT =
  `Rapid Serial Visual Presentation or RSVP is a speed reading technique that ` +
  `displays words one at a time at a fixed position on screen. Your eyes stay ` +
  `perfectly still while text streams past. The red letter marks the Optimal ` +
  `Recognition Point. It is the key anchor your brain uses to instantly decode ` +
  `each word. By eliminating eye movements RSVP lets you process text faster. ` +
  `Research suggests most people can comfortably read between 300 and 600 words ` +
  `per minute using this method. The default speed here is 360 words per minute. ` +
  `Press play to begin and gradually increase the speed as you grow comfortable.`;

// ─── ORP index ────────────────────────────────────────────────────────────────
// Places the Optimal Recognition Point at ~30% into the word.
// A trailing dot is excluded so the sentence period is never highlighted.
// Examples: "the"→0  "word"→1  "about"→1  "reading"→2  "comfortable"→3
function orpIndex(word) {
  const base = word.endsWith('.') ? word.slice(0, -1) : word;
  const len  = base.length || 1;
  return Math.min(len - 1, Math.floor(len * 0.3));
}

// ─── Text cleaning ────────────────────────────────────────────────────────────
// Strip everything except English letters (a-z A-Z), digits, dots and whitespace.
function cleanText(text) {
  return text
    .replace(/[^a-zA-Z0-9.\s]/g, '')  // remove disallowed characters
    .replace(/\s+/g, ' ')              // collapse runs of whitespace
    .trim();
}

// ─── Tokenise text into words ──────────────────────────────────────────────────
// Standalone dot tokens (e.g. from "Hello . World") are merged onto the
// preceding word so the period always travels with the word before it.
function tokenise(text) {
  const raw = text.trim().split(/\s+/).filter(w => w.length > 0);
  const out = [];
  for (const w of raw) {
    if (w === '.' && out.length > 0) {
      out[out.length - 1] += '.';   // attach loose dot to previous word
    } else {
      out.push(w);
    }
  }
  return out;
}

// ─── State ────────────────────────────────────────────────────────────────────
let words          = [];
let index          = 0;      // current word index
let wpm            = 360;
let speedMode      = 'fixed'; // 'fixed' | 'ramp'
let playing        = false;
let timer          = null;
let wordStartTimes = [];     // cumulative ms to start of each word
let totalDuration  = 0;      // total ms for entire sequence
let rampBreaks     = [];     // [b1, b2, b3] word indices where speed steps up

// ─── Ramp breakpoints ─────────────────────────────────────────────────────────
// Snaps the 25%/50%/75% thresholds to the nearest sentence-start index so
// speed steps only happen at the beginning of a sentence.
function computeRampBreakpoints() {
  if (!words.length) { rampBreaks = []; return; }

  // Collect every sentence-start index: index 0, plus every index that
  // immediately follows a dot-word.
  const starts = [0];
  for (let i = 1; i < words.length; i++) {
    if (words[i - 1].endsWith('.')) starts.push(i);
  }

  // For each threshold find the sentence start closest to it.
  rampBreaks = [0.25, 0.50, 0.75].map(t => {
    const target = t * words.length;
    return starts.reduce((best, s) =>
      Math.abs(s - target) < Math.abs(best - target) ? s : best
    , starts[0]);
  });
}

// ─── Timing helpers ───────────────────────────────────────────────────────────
// Must be called after words[] or wpm changes.
function computeTimings() {
  computeRampBreakpoints();
  wordStartTimes = [];
  let t = 0;
  for (let i = 0; i < words.length; i++) {
    wordStartTimes.push(t);
    t += msForWord(words[i], i);
  }
  totalDuration = t;
}

function formatSecs(ms) { return `${Math.round(ms / 1000)} sec`; }

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const textInput   = document.getElementById('textInput');
const wpmInput    = document.getElementById('wpmInput');
const btnPlay     = document.getElementById('btnPlay');
const btnStop     = document.getElementById('btnStop');
const btnRewind   = document.getElementById('btnRewind');
const btnForward  = document.getElementById('btnForward');
const btnWpmDown  = document.getElementById('wpmDown');
const btnWpmUp    = document.getElementById('wpmUp');
const elLeft      = document.getElementById('wordLeft');
const elOrp       = document.getElementById('wordOrp');
const elRight     = document.getElementById('wordRight');
const elCounter    = document.getElementById('wordCounter');
const elHint       = document.getElementById('hint');
const wordRow      = document.querySelector('.word-row');
const pivotTop     = document.getElementById('pivotTop');
const pivotBottom  = document.getElementById('pivotBottom');
const displayPanel = document.querySelector('.panel-display');
const seekbarTrack  = document.getElementById('seekbarTrack');
const seekbarFill   = document.getElementById('seekbarFill');
const seekbarThumb  = document.getElementById('seekbarThumb');
const seekbarTime   = document.getElementById('seekbarTime');
const btnModeFixed  = document.getElementById('btnModeFixed');
const btnModeRamp   = document.getElementById('btnModeRamp');
const wpmControl    = document.getElementById('wpmControl');
const speedBadge    = document.getElementById('speedBadge');

// ─── Pivot tick alignment ─────────────────────────────────────────────────────
// After the DOM is ready, measure where the ORP element sits so the tick marks
// line up exactly above and below it regardless of window width.
function alignPivots() {
  const panelRect = displayPanel.getBoundingClientRect();
  const orpRect   = elOrp.getBoundingClientRect();
  const orpCenterX = orpRect.left + orpRect.width / 2 - panelRect.left;
  const offset = `${orpCenterX - 1.5}px`; // half pivot width (3px)
  pivotTop.style.left    = offset;
  pivotBottom.style.left = offset;
  // vertical positions
  const orpTop    = orpRect.top - panelRect.top;
  const orpBottom = orpRect.bottom - panelRect.top;
  pivotTop.style.top    = `${orpTop - 18}px`;
  pivotBottom.style.top = `${orpBottom + 4}px`;
}

// ─── Display a word ───────────────────────────────────────────────────────────
function showWord(i) {
  if (!words.length) {
    elLeft.textContent  = '';
    elOrp.textContent   = '●';
    elRight.textContent = '';
    setHint('Enter text above and press ▶ to start');
    updateSeekbar();
    updateSpeedBadge(0);
    setCounter('Word — / —');
    return;
  }

  setHint(null); // hide hint

  const word = words[i] || '';
  const orp  = orpIndex(word);

  elLeft.textContent  = word.slice(0, orp);
  elOrp.textContent   = word[orp]  || '';
  elRight.textContent = word.slice(orp + 1);

  setCounter(`Word ${i + 1} / ${words.length}`);
  updateSpeedBadge(i);
  updateSeekbar();

  // Re-align pivot ticks after text change (character widths may differ)
  requestAnimationFrame(alignPivots);
}

function setCounter(text) { elCounter.textContent = text; }

function updateSpeedBadge(idx) {
  const v = effectiveWpm(idx);
  speedBadge.textContent = `${v} WPM`;
  speedBadge.classList.toggle('is-ramp', speedMode === 'ramp');
}

function updateSeekbar() {
  if (!words.length || totalDuration === 0) {
    seekbarFill.style.width  = '0%';
    seekbarThumb.style.left  = '0%';
    seekbarTime.textContent  = '0 sec of 0 sec';
    return;
  }
  const currentMs = wordStartTimes[index] || 0;
  const pct = `${(currentMs / totalDuration * 100).toFixed(2)}%`;
  seekbarFill.style.width = pct;
  seekbarThumb.style.left = pct;
  seekbarTime.textContent =
    `${formatSecs(currentMs)} of ${formatSecs(totalDuration)}`;
}

function setHint(text) {
  if (text) {
    elHint.textContent = text;
    elHint.classList.remove('hidden');
  } else {
    elHint.classList.add('hidden');
  }
}

// ─── Playback control ─────────────────────────────────────────────────────────

// Ramp schedule: 300 → 400 → 500 → 600 WPM, with transitions snapped to the
// nearest sentence start around the 25%/50%/75% positions.
function wpmForIndex(idx) {
  if (!words.length || !rampBreaks.length) return 300;
  if (idx < rampBreaks[0]) return 300;
  if (idx < rampBreaks[1]) return 400;
  if (idx < rampBreaks[2]) return 500;
  return 600;
}

// Effective WPM for a given word position — respects the current mode.
function effectiveWpm(idx) {
  return speedMode === 'ramp' ? wpmForIndex(idx) : wpm;
}

// Fixed extra pause added after every sentence-ending word, regardless of speed.
const SENTENCE_PAUSE_MS = 400;

// Delay in ms for word at position idx. Dot-words get a fixed extra pause on
// top of the normal word time so sentence breaks feel consistent at any speed.
function msForWord(word, idx) {
  const base = Math.round(60000 / effectiveWpm(idx));
  return word && word.endsWith('.') ? base + SENTENCE_PAUSE_MS : base;
}

// setTimeout-based scheduler — allows per-word variable timing.
function scheduleNext() {
  const delay = msForWord(words[index], index);
  timer = setTimeout(() => {
    index++;
    if (index >= words.length) {
      // reached end — stop and stay on last word
      pause();
      index = words.length - 1;
      showWord(index);
      return;
    }
    showWord(index);
    if (playing) scheduleNext();
  }, delay);
}

function play() {
  if (!words.length) {
    words = tokenise(textInput.value);
    if (!words.length) return;
    index = 0;
    computeTimings();
  }
  if (index >= words.length) index = 0;

  playing = true;
  btnPlay.textContent = '⏸';
  btnPlay.title = 'Pause  [Space]';

  showWord(index);
  scheduleNext();
}

function pause() {
  playing = false;
  clearTimeout(timer);
  timer = null;
  btnPlay.textContent = '▶';
  btnPlay.title = 'Play  [Space]';
}

function stop() {
  pause();
  index = 0;
  showWord(words.length ? 0 : -1);
}

function rewind() {
  index = Math.max(0, index - 10);
  if (playing) { clearTimeout(timer); play(); }
  else showWord(index);
}

function forward() {
  if (!words.length) return;
  index = Math.min(words.length - 1, index + 10);
  if (playing) { clearTimeout(timer); play(); }
  else showWord(index);
}

function setWpm(value) {
  const v = Math.min(1200, Math.max(60, Math.round(value / 10) * 10));
  wpm = v;
  wpmInput.value = v;
  computeTimings();  // durations change with wpm
  updateSeekbar();
  updateSpeedBadge(index);
  if (playing) { clearTimeout(timer); play(); }
}

// ─── Initialise ───────────────────────────────────────────────────────────────
textInput.value = DEFAULT_TEXT;
words = tokenise(DEFAULT_TEXT);
computeTimings();
showWord(0);

// Align pivots once fonts are loaded
document.fonts.ready.then(alignPivots);
window.addEventListener('resize', alignPivots);

// ─── Button events ────────────────────────────────────────────────────────────
btnPlay.addEventListener('click',    () => playing ? pause() : play());
btnStop.addEventListener('click',    stop);
btnRewind.addEventListener('click',  rewind);
btnForward.addEventListener('click', forward);

btnWpmDown.addEventListener('click', () => setWpm(wpm - 30));
btnWpmUp.addEventListener('click',   () => setWpm(wpm + 30));

wpmInput.addEventListener('change', () => {
  const v = parseInt(wpmInput.value, 10);
  if (!isNaN(v)) setWpm(v);
});

// Re-parse text when edited; reset playback
textInput.addEventListener('input', () => {
  if (playing) pause();
  words = tokenise(textInput.value);
  index = 0;
  computeTimings();
  showWord(words.length ? 0 : -1);
});

// Clean pasted text before inserting it into the textarea
textInput.addEventListener('paste', e => {
  e.preventDefault();
  const raw     = (e.clipboardData || window.clipboardData).getData('text');
  const cleaned = cleanText(raw);
  // Insert at cursor, replacing any current selection
  const start = textInput.selectionStart;
  const end   = textInput.selectionEnd;
  textInput.value =
    textInput.value.slice(0, start) + cleaned + textInput.value.slice(end);
  textInput.selectionStart = textInput.selectionEnd = start + cleaned.length;
  // Trigger re-parse
  textInput.dispatchEvent(new Event('input'));
});

// ─── Mode toggle ─────────────────────────────────────────────────────────────
function setSpeedMode(mode) {
  speedMode = mode;
  btnModeFixed.classList.toggle('is-active', mode === 'fixed');
  btnModeRamp.classList.toggle('is-active',  mode === 'ramp');
  wpmControl.classList.toggle('is-disabled', mode === 'ramp');
  computeTimings();   // durations change with mode
  updateSeekbar();
  updateSpeedBadge(index);
  if (playing) { clearTimeout(timer); play(); }
  else showWord(index);
}

btnModeFixed.addEventListener('click', () => setSpeedMode('fixed'));
btnModeRamp.addEventListener('click',  () => setSpeedMode('ramp'));

// ─── Seekbar interaction ──────────────────────────────────────────────────────
let seekDragging   = false;
let seekWasPlaying = false;

function getTrackRatio(e) {
  const rect = seekbarTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

function seekToRatio(ratio) {
  if (!wordStartTimes.length) return;
  const targetMs = ratio * totalDuration;
  let i = 0;
  while (i < wordStartTimes.length - 1 && wordStartTimes[i + 1] <= targetMs) i++;
  index = i;
  showWord(index);
}

seekbarTrack.addEventListener('mousedown', e => {
  e.preventDefault();
  seekDragging   = true;
  seekWasPlaying = playing;
  if (playing) { clearTimeout(timer); timer = null; }
  seekToRatio(getTrackRatio(e));
});

document.addEventListener('mousemove', e => {
  if (!seekDragging) return;
  seekToRatio(getTrackRatio(e));
});

document.addEventListener('mouseup', () => {
  if (!seekDragging) return;
  seekDragging = false;
  if (seekWasPlaying) scheduleNext();
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Don't intercept keys while typing in the textarea
  if (document.activeElement === textInput) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      playing ? pause() : play();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      rewind();
      break;
    case 'ArrowRight':
      e.preventDefault();
      forward();
      break;
    case 'Escape':
      e.preventDefault();
      stop();
      break;
  }
});
