// Download, decode and analyze a track, then pick where DJPJ will mix in and out of it.
// Full tracks get phrase-aligned in/out points. 30-second previews get a DJ edit: whole bars
// re-arranged (hook repeats, intro vamps, outro loops) so a clip plays about as long as a real
// DJ would let that genre's records run.
import { analyze, structure, loudest } from './analyze.js';
import { mixFor } from '../genres.js';

const TARGET_RMS = 0.13;                       // loudness every track is matched to
const VIBE = { smooth: 1.25, club: 1, hype: 0.75 };
// measured play times spread about ±35% around the median, so vary each record by about that much
const spread = () => Math.exp((Math.random() - 0.5) * 0.7);
const XFADE = 0.008;                           // crossfade at each edit splice, in seconds

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject); // callback form for older Safari
    if (p?.then) p.then(resolve, reject);
  });
}

function crop(ctx, buf, from, to, fade = 0) {
  const sr = buf.sampleRate;
  const i0 = Math.max(0, Math.floor(from * sr)), i1 = Math.min(buf.length, Math.floor(to * sr));
  const n = Math.max(1, i1 - i0), f = Math.min(Math.floor(fade * sr), n >> 1);
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.copyToChannel(buf.getChannelData(ch).subarray(i0, i1), ch);
    if (f) {
      const d = out.getChannelData(ch);
      for (let i = 0; i < f; i++) { d[i] *= i / f; d[n - 1 - i] *= i / f; }
    }
  }
  return out;
}

// Splice [from, to) pieces of `buf` (track seconds) end to end, crossfading each join.
function splice(ctx, buf, pieces) {
  const sr = buf.sampleRate, f = Math.floor(XFADE * sr);
  const lens = pieces.map(([a, b]) => Math.max(0, Math.floor(b * sr) - Math.floor(a * sr)));
  const out = ctx.createBuffer(buf.numberOfChannels, Math.max(1, lens.reduce((s, n) => s + n, 0) + f), sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
    let w = 0;
    pieces.forEach(([a], k) => {
      const i0 = Math.floor(a * sr), n = lens[k];
      for (let i = 0; i < n + f; i++) {
        const x = src[i0 + i] || 0;
        const g = k && i < f ? i / f : i >= n ? 1 - (i - n) / f : 1; // fade in over the previous piece's tail
        dst[w + i] += x * g;
      }
      w += n;
    });
  }
  return out;
}

// Edit shapes for a preview, in bars of the clip. h0..h1 is the hook, n the clip length.
const EDITS = {
  straight: (n) => [[0, n]],
  'hook repeat': (n, h0, h1) => [[0, h1], [h0, n]],
  'double hook': (n, h0, h1) => [[0, h1], [h0, h1], [h0, n]],
  'intro vamp': (n) => [[0, 2], [0, 2], [0, n]],
  reprise: (n, h0) => [[0, n], [h0, n]],
  'outro loop': (n) => [[0, n], [n - 2, n], [n - 2, n]],
  'vamp + hook': (n, h0, h1) => [[0, 2], [0, h1], [h0, n]],
};
let lastEdit = null;

function pickEdit(n, h0, h1, wantBars) {
  const options = Object.entries(EDITS)
    .filter(([k]) => k !== lastEdit)
    .map(([k, f]) => {
      const pieces = f(n, h0, h1);
      const bars = pieces.reduce((s, [a, b]) => s + b - a, 0);
      return { k, pieces, bars, score: Math.abs(bars - wantBars) / wantBars + Math.random() * 0.35 };
    })
    .sort((x, y) => x.score - y.score);
  lastEdit = options[0].k;
  return options[0];
}

export async function prepareTrack(track, ctx, { signal, style = 'club', genre }) {
  if (track.prep) return track;
  if (track.resolve) await track.resolve(signal);
  const res = await fetch(track.url, { signal });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const full = await decode(ctx, await res.arrayBuffer());
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const a = analyze(full, track.bpm);
  const s = structure(full, a);
  const spb = 60 / a.bpm, bar = 4 * spb, phrase = 8 * bar;
  const mix = mixFor(genre);
  const target = mix.play * (VIBE[style] ?? 1) * spread();
  const beatSync = !!track.beatSync && a.confidence > 1.25;
  const common = {
    bpm: a.bpm,
    gain: Math.min(4, Math.max(0.25, TARGET_RMS / a.rms)),
    beatSync,
    confidence: a.confidence,
    family: mix.family,
    target,
  };
  track.prep = track.isPreview
    ? previewPrep(ctx, full, a, s, { spb, bar, target, beatSync, common })
    : fullPrep(ctx, full, a, s, { spb, bar, phrase, target, style, family: mix.family, common });
  return track;
}

function fullPrep(ctx, full, a, s, { spb, bar, phrase, target, style, family, common }) {
  const dur = full.duration;
  const onGrid = (t, step, origin) => origin + Math.ceil((t - origin) / step - 1e-3) * step;
  const barAfter = t => onGrid(t, bar, s.downbeat);
  const phraseAfter = t => onGrid(t, phrase, s.phraseStart);

  let inPoint = phraseAfter(a.start - 0.05);
  if (inPoint - a.start > 4 * bar) inPoint = barAfter(a.start);
  // quick mixers drop in where the beat is going; club DJs keep the intro to mix over
  const skipOdds = family === 'urban' ? { smooth: 0.3, club: 0.7, hype: 1 }[style] : family === 'club' ? 0 : 0.2;
  if (Math.random() < skipOdds) {
    const j0 = Math.round((inPoint - s.downbeat) / bar);
    const k = s.bars.findIndex((e, j) => j >= j0 && e > 0.85);
    const drop = k >= 0 ? phraseAfter(s.downbeat + k * bar - 0.05) : inPoint;
    if (drop > inPoint && drop < dur * 0.35) inPoint = drop;
  }
  const phrases = Math.max(2, Math.round(target / phrase));
  // out on a phrase line even when the record had to start on a plain bar
  let outPoint = phraseAfter(inPoint + phrases * phrase - 4 * bar);
  const last = a.end - 6;
  while (outPoint > last && outPoint - phrase > inPoint + phrase) outPoint -= phrase;
  if (outPoint > last) outPoint = inPoint + Math.max(4, Math.floor((last - inPoint) / bar)) * bar;
  if (outPoint > a.end) outPoint = Math.max(inPoint + 8, a.end - 0.25);

  const hookAt = loudest(s, spb, inPoint, outPoint, 4);
  // keep a little before the in point (backspins, scratches) and some room to extend the out point
  const from = Math.max(0, inPoint - 5);
  const to = Math.min(dur, outPoint + 30);
  return {
    ...common,
    buffer: crop(ctx, full, from, to),
    firstBeat: a.firstBeat - from,
    downbeat: s.downbeat - from,
    phraseStart: s.phraseStart - from,
    inPoint: inPoint - from,
    outPoint: outPoint - from,
    maxPoint: Math.min(to - from - 0.5, a.end - from),
    hookAt: hookAt == null ? null : hookAt - from,
    hook: hookAt == null ? null : { buffer: crop(ctx, full, hookAt, hookAt + 4 * bar, 0.004), bpm: a.bpm, bars: 4 },
    edit: null,
  };
}

function previewPrep(ctx, full, a, s, { spb, bar, target, beatSync, common }) {
  // previews fade in for about a second and fade out over the last two or three
  const barAfter = t => s.downbeat + Math.ceil((t - s.downbeat) / bar - 1e-3) * bar;
  const clipIn = barAfter(Math.max(a.start, 0.8));
  const n = Math.max(1, Math.floor((a.end - 2.5 - clipIn) / bar));
  const clipOut = clipIn + n * bar;
  const hookBars = n >= 8 ? 4 : 2;
  const hookAt = loudest(s, spb, clipIn, clipOut, hookBars) ?? clipIn;
  const h0 = Math.round((hookAt - clipIn) / bar), h1 = Math.min(n, h0 + hookBars);
  const pre = Math.min(clipIn, 2); // a bit of lead-in for scratches and backspins

  let edit = { k: 'straight', pieces: [[0, n]] };
  // re-arranging bars only works on a solid beat grid
  if (beatSync && n >= 6) edit = pickEdit(n, h0, h1, Math.min(target, 2.4 * n * bar) / bar);
  const toTime = ([x, y]) => [clipIn + x * bar, clipIn + y * bar];
  const pieces = [[clipIn - pre, clipIn], ...edit.pieces.map(toTime), [clipOut, Math.min(full.duration, a.end)]];
  const buffer = edit.k === 'straight' ? crop(ctx, full, clipIn - pre, a.end) : splice(ctx, full, pieces);
  const editLen = edit.pieces.reduce((t, [x, y]) => t + (y - x), 0) * bar;
  // where the hook first plays inside the edited buffer
  let w = pre, hookIn = null;
  for (const [x, y] of edit.pieces) {
    if (hookIn == null && x <= h0 && y >= h1) hookIn = w + (h0 - x) * bar;
    w += (y - x) * bar;
  }
  return {
    ...common,
    buffer,
    firstBeat: pre,
    downbeat: pre,
    phraseStart: pre,
    inPoint: pre,
    outPoint: pre + editLen,
    maxPoint: buffer.duration - 0.05,
    hookAt: hookIn,
    hook: { buffer: crop(ctx, full, hookAt, hookAt + hookBars * bar, 0.004), bpm: a.bpm, bars: hookBars },
    edit: edit.k === 'straight' ? null : edit.k,
  };
}
