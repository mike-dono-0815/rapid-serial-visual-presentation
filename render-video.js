#!/usr/bin/env node
'use strict';

/**
 * render-video.js
 *
 * Generates an MP4 video of the RSVP sequence at the exact playback timing.
 * One PNG frame is rendered per word; ffmpeg replicates each frame for exactly
 * the right number of milliseconds, producing a mathematically accurate video.
 *
 * Usage:
 *   node render-video.js [options]
 *   npm run render-video -- [options]
 *
 * Options:
 *   --text   <path>       Plain-text file to read (default: built-in sample)
 *   --wpm    <n>          Words per minute for fixed mode (default: 360)
 *   --mode   fixed|ramp   Speed mode (default: fixed)
 *   --fps    <n>          Output frame rate (default: 60)
 *   --width  <n>          Frame width  in px (default: 1280)
 *   --height <n>          Frame height in px (default: 720)
 *   --output <path>       Output MP4 file (default: rsvp-video.mp4)
 *
 * Examples:
 *   node render-video.js --wpm 400 --output demo.mp4
 *   node render-video.js --text my-article.txt --mode ramp --output ramp.mp4
 */

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { spawnSync }                  = require('child_process');
const ffmpegBin                      = require('ffmpeg-static');
const path                           = require('path');
const fs                             = require('fs');
const os                             = require('os');

// ─── CLI args ─────────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const textFile   = arg('text',   null);
const fixedWpm   = parseInt(arg('wpm',    '360'), 10);
const mode       = arg('mode',   'fixed');       // 'fixed' | 'ramp'
const fps        = parseInt(arg('fps',    '60'),  10);
const W          = parseInt(arg('width',  '1280'), 10);
const H          = parseInt(arg('height', '720'),  10);
const outputFile = arg('output', 'rsvp-video.mp4');

// ─── Visual constants (match app) ─────────────────────────────────────────────
const BG           = '#08081a';
const FG           = '#dcdcf5';
const ORANGE       = '#FF9900';
const MUTED        = '#6060a0';
const FONT_SIZE    = Math.round(H * 0.1);          // 72px @ 720p
const BADGE_SIZE   = Math.round(FONT_SIZE * 0.5);
const FONT_DISPLAY = `${FONT_SIZE}px Consolas, 'Courier New', monospace`;
const FONT_BADGE   = `bold ${BADGE_SIZE}px Consolas, 'Courier New', monospace`;
const FONT_UI      = `${Math.round(H * 0.02)}px sans-serif`;

// ─── Timing constants (match app) ─────────────────────────────────────────────
const SENTENCE_PAUSE_MS = 400;

// ─── Default text ─────────────────────────────────────────────────────────────
const DEFAULT_TEXT =
  'Rapid Serial Visual Presentation or RSVP is a speed reading technique that ' +
  'displays words one at a time at a fixed position on screen. Your eyes stay ' +
  'perfectly still while text streams past. The orange letter marks the Optimal ' +
  'Recognition Point. It is the key anchor your brain uses to instantly decode ' +
  'each word. By eliminating eye movements RSVP lets you process text faster. ' +
  'Research suggests most people can comfortably read between 300 and 600 words ' +
  'per minute using this method. The default speed here is 360 words per minute. ' +
  'Press play to begin and gradually increase the speed as you grow comfortable.';

// ─── Text processing (mirrors app.js) ─────────────────────────────────────────
function cleanText(t) {
  return t.replace(/[^a-zA-Z0-9.\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenise(text) {
  const raw = text.trim().split(/\s+/).filter(w => w.length > 0);
  const out = [];
  for (const w of raw) {
    if (w === '.' && out.length > 0) out[out.length - 1] += '.';
    else out.push(w);
  }
  return out;
}

function orpIndex(word) {
  const base = word.endsWith('.') ? word.slice(0, -1) : word;
  const len  = base.length || 1;
  return Math.min(len - 1, Math.floor(len * 0.3));
}

function computeRampBreaks(words) {
  if (!words.length) return [];
  const starts = [0];
  for (let i = 1; i < words.length; i++) {
    if (words[i - 1].endsWith('.')) starts.push(i);
  }
  return [0.25, 0.50, 0.75].map(t => {
    const target = t * words.length;
    return starts.reduce((best, s) =>
      Math.abs(s - target) < Math.abs(best - target) ? s : best, starts[0]);
  });
}

function wpmAt(idx, rampBreaks) {
  if (mode !== 'ramp') return fixedWpm;
  if (!rampBreaks.length) return 300;
  if (idx < rampBreaks[0]) return 300;
  if (idx < rampBreaks[1]) return 400;
  if (idx < rampBreaks[2]) return 500;
  return 600;
}

function msForWord(word, idx, rampBreaks) {
  const base = Math.round(60000 / wpmAt(idx, rampBreaks));
  return word.endsWith('.') ? base + SENTENCE_PAUSE_MS : base;
}

function formatSecs(ms) { return `${Math.round(ms / 1000)} sec`; }

// ─── Rounded rect helper ──────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ─── Build word list + timings ────────────────────────────────────────────────
const rawText = textFile ? fs.readFileSync(textFile, 'utf8') : DEFAULT_TEXT;
const words   = tokenise(cleanText(rawText));

if (!words.length) { console.error('No words found in input.'); process.exit(1); }

const rampBreaks = computeRampBreaks(words);

const startTimes = [];
let totalDuration = 0;
for (let i = 0; i < words.length; i++) {
  startTimes.push(totalDuration);
  totalDuration += msForWord(words[i], i, rampBreaks);
}

console.log(`\nRapid Serial Visual Presentation — Video Renderer`);
console.log(`${'─'.repeat(50)}`);
console.log(`  Words    : ${words.length}`);
console.log(`  Duration : ${(totalDuration / 1000).toFixed(1)} sec`);
console.log(`  Mode     : ${mode}${mode === 'fixed' ? ` @ ${fixedWpm} WPM` : ' (300→400→500→600 WPM)'}`);
console.log(`  Output   : ${W}×${H} @ ${fps} fps → ${outputFile}`);
console.log(`${'─'.repeat(50)}\n`);

// ─── Setup canvas + fonts ─────────────────────────────────────────────────────
// Load system fonts so Consolas/Courier New are available
try { GlobalFonts.loadSystemFonts(); } catch (_) {}

const canvas = createCanvas(W, H);
const ctx    = canvas.getContext('2d');

// Measure monospace character width at display font size
ctx.font = FONT_DISPLAY;
const charWidth = ctx.measureText('W').width;
const centerX   = W / 2;
const centerY   = H / 2;

// ─── Render a single frame ────────────────────────────────────────────────────
function renderFrame(wordIdx) {
  const word        = words[wordIdx];
  const orp         = orpIndex(word);
  const leftPart    = word.slice(0, orp);
  const orpChar     = word[orp] || '';
  const rightPart   = word.slice(orp + 1);
  const currentWpm  = wpmAt(wordIdx, rampBreaks);
  const startMs     = startTimes[wordIdx];
  const progress    = totalDuration > 0 ? startMs / totalDuration : 0;

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Speed badge — top right
  ctx.font         = FONT_BADGE;
  ctx.fillStyle    = mode === 'ramp' ? ORANGE : MUTED;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${currentWpm} WPM`, W - 20, 16);

  // Pivot ticks (orange bars above / below ORP character)
  const orpLeft  = centerX - charWidth / 2;
  const ascent   = FONT_SIZE * 0.72;
  const descent  = FONT_SIZE * 0.18;
  const tickW    = 3;
  const tickH    = Math.round(H * 0.02);
  ctx.fillStyle   = ORANGE;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(orpLeft + charWidth / 2 - tickW / 2, centerY - ascent - tickH - 4, tickW, tickH);
  ctx.fillRect(orpLeft + charWidth / 2 - tickW / 2, centerY + descent + 4, tickW, tickH);
  ctx.globalAlpha = 1.0;

  // Word: left | ORP | right  (ORP char centred on the canvas horizontally)
  ctx.font         = FONT_DISPLAY;
  ctx.textBaseline = 'middle';

  ctx.fillStyle = FG;
  ctx.textAlign = 'right';
  ctx.fillText(leftPart, orpLeft, centerY);

  ctx.fillStyle = ORANGE;
  ctx.textAlign = 'left';
  ctx.fillText(orpChar, orpLeft, centerY);

  ctx.fillStyle = FG;
  ctx.textAlign = 'left';
  ctx.fillText(rightPart, orpLeft + charWidth, centerY);

  // Seekbar
  const BAR_H   = Math.max(4, Math.round(H * 0.007));
  const BAR_Y   = H - Math.round(H * 0.035);
  const BAR_L   = Math.round(W * 0.015);
  const BAR_W   = W - BAR_L * 2;
  const fillW   = Math.max(0, BAR_W * progress);
  const thumbX  = BAR_L + fillW;
  const thumbR  = Math.round(H * 0.01);

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, BAR_L, BAR_Y, BAR_W, BAR_H, 2);
  ctx.fill();

  // Fill
  if (fillW > 0) {
    ctx.fillStyle   = ORANGE;
    ctx.globalAlpha = 0.85;
    roundRect(ctx, BAR_L, BAR_Y, fillW, BAR_H, 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Thumb
  ctx.beginPath();
  ctx.arc(thumbX, BAR_Y + BAR_H / 2, thumbR, 0, Math.PI * 2);
  ctx.fillStyle = ORANGE;
  ctx.fill();

  // Time label
  ctx.font         = FONT_UI;
  ctx.fillStyle    = MUTED;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    `${formatSecs(startMs)} of ${formatSecs(totalDuration)}`,
    W - BAR_L, BAR_Y - 4
  );
}

// ─── Write frames + build ffmpeg concat list ──────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-frames-'));
const concatLines = ['ffconcat version 1.0'];

process.stdout.write('  Rendering frames  ');
const barWidth = 30;

for (let i = 0; i < words.length; i++) {
  // Progress bar
  const pct      = (i + 1) / words.length;
  const filled   = Math.round(pct * barWidth);
  const bar      = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  process.stdout.write(`\r  Rendering frames  [${bar}]  ${i + 1}/${words.length}`);

  renderFrame(i);

  const frameName = `frame-${String(i).padStart(6, '0')}.png`;
  const framePath = path.join(tmpDir, frameName);
  fs.writeFileSync(framePath, canvas.toBuffer('image/png'));

  const durationSec = msForWord(words[i], i, rampBreaks) / 1000;
  concatLines.push(`file '${framePath.replace(/\\/g, '/')}'`);
  concatLines.push(`duration ${durationSec.toFixed(6)}`);
}

// Repeat last frame — fixes ffmpeg concat last-frame duration bug
const lastPath = path.join(tmpDir, `frame-${String(words.length - 1).padStart(6, '0')}.png`);
concatLines.push(`file '${lastPath.replace(/\\/g, '/')}'`);

console.log('\n  Frames complete.');

const concatFile = path.join(tmpDir, 'concat.txt');
fs.writeFileSync(concatFile, concatLines.join('\n'));

// ─── Encode with ffmpeg ───────────────────────────────────────────────────────
console.log('  Encoding video …');

const result = spawnSync(ffmpegBin, [
  '-y',
  '-f',        'concat',
  '-safe',     '0',
  '-i',        concatFile,
  '-vf',       `fps=${fps}`,
  '-c:v',      'libx264',
  '-pix_fmt',  'yuv420p',
  '-crf',      '18',
  '-preset',   'fast',
  outputFile
], { stdio: ['ignore', 'ignore', 'pipe'] });

// ─── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(tmpDir, { recursive: true, force: true });

if (result.status === 0) {
  const stat = fs.statSync(outputFile);
  console.log(`\n  ✓ Done!`);
  console.log(`  File   : ${path.resolve(outputFile)}`);
  console.log(`  Size   : ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Length : ${(totalDuration / 1000).toFixed(1)} sec @ ${fps} fps\n`);
} else {
  console.error('\n  ffmpeg failed:');
  if (result.stderr) console.error(result.stderr.toString());
  process.exit(1);
}
