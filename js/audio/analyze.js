// Track analysis: tempo, beat grid, loudness and where the sound starts/ends.
// Tempo comes from autocorrelating a kick-weighted onset envelope, then a comb-filter search
// refines the BPM to 0.05 and finds the beat phase.

export function analyze(buffer, hintBpm = null) {
  const sr = buffer.sampleRate, n = buffer.length, dur = buffer.duration;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;

  // loudness and silence bounds
  let sum = 0, count = 0;
  for (let i = 0; i < n; i += 8) {
    const x = (L[i] + R[i]) * 0.5;
    sum += x * x;
    count++;
  }
  const rms = Math.sqrt(sum / Math.max(1, count)) || 0.1;
  const thr = Math.max(0.01, rms * 0.15);
  let first = 0, last = n - 1;
  while (first < n && Math.abs(L[first]) < thr && Math.abs(R[first]) < thr) first++;
  while (last > first && Math.abs(L[last]) < thr && Math.abs(R[last]) < thr) last--;
  const start = first / sr, end = last / sr;

  // onset envelope over an analysis window in the body of the track
  const hop = 512, fps = sr / hop;
  const aStart = dur > 70 ? Math.min(dur * 0.25, 50) : start;
  const aLen = Math.max(4, Math.min(45, end - aStart));
  const i0 = Math.floor(aStart * sr);
  const frames = Math.floor((aLen * sr) / hop);
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  const onset = new Float32Array(frames);
  let lp = 0, prevLow = 0, prevAll = 0;
  for (let f = 0; f < frames; f++) {
    let eLow = 0, eAll = 0;
    const base = i0 + f * hop;
    for (let j = 0; j < hop; j++) {
      const x = (L[base + j] + R[base + j]) * 0.5 || 0;
      lp += alpha * (x - lp);
      eLow += lp * lp;
      eAll += x * x;
    }
    const low = Math.log(1e-7 + eLow), all = Math.log(1e-7 + eAll);
    onset[f] = f ? Math.max(0, low - prevLow) + 0.5 * Math.max(0, all - prevAll) : 0;
    prevLow = low;
    prevAll = all;
  }
  let mean = 0;
  for (let f = 0; f < frames; f++) mean += onset[f];
  mean /= Math.max(1, frames);
  for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - mean);

  // coarse tempo: autocorrelation across 60-200 BPM with a gentle preference for ~120
  let coarse = 120;
  if (hintBpm && hintBpm >= 60 && hintBpm <= 200) {
    coarse = hintBpm;
  } else {
    const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60);
    let best = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0;
      for (let i = 0; i + lag < frames; i++) ac += onset[i] * onset[i + lag];
      const bpm = (fps * 60) / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      const score = (ac / (frames - lag)) * prior;
      if (score > best) {
        best = score;
        coarse = bpm;
      }
    }
  }
  while (coarse < 78) coarse *= 2;
  while (coarse > 168) coarse /= 2;

  // refine BPM and phase with a comb filter over the onset envelope
  const sample = x => {
    const i = Math.floor(x), fr = x - i;
    return i + 1 < frames ? onset[i] * (1 - fr) + onset[i + 1] * fr : 0;
  };
  let bestScore = -Infinity, bestBpm = coarse, bestPhase = 0, total = 0, tries = 0;
  for (let bpm = coarse - 1.5; bpm <= coarse + 1.5; bpm += 0.05) {
    const period = (fps * 60) / bpm;
    for (let ph = 0; ph < period; ph += 0.5) {
      let s = 0;
      for (let x = ph; x < frames; x += period) s += sample(x);
      total += s;
      tries++;
      if (s > bestScore) {
        bestScore = s;
        bestBpm = bpm;
        bestPhase = ph;
      }
    }
  }
  const confidence = bestScore / Math.max(1e-9, total / tries);

  const spb = 60 / bestBpm;
  const beatInWindow = aStart + (bestPhase * hop + hop / 2) / sr;
  const firstBeat = beatInWindow - Math.floor((beatInWindow - start) / spb) * spb;

  return { bpm: Math.round(bestBpm * 100) / 100, firstBeat, start, end, rms, confidence };
}

// Song structure on top of the beat grid: which beat is the "one", where the 8-bar phrases start
// (sections in pop and dance music change on those lines), how loud each bar is, and the hook,
// the loudest 4-bar stretch, which DJPJ loops, teases and calls back.
export function structure(buffer, a) {
  const sr = buffer.sampleRate, spb = 60 / a.bpm;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  const beats = [];
  for (let t = a.firstBeat; t + spb <= a.end; t += spb) {
    const i0 = Math.floor(t * sr), i1 = Math.floor((t + spb) * sr), kickEnd = i0 + Math.floor((i1 - i0) / 4);
    let all = 0, kick = 0, lp = 0;
    for (let i = i0; i < i1; i += 2) {
      const x = (L[i] + R[i]) * 0.5 || 0;
      lp += alpha * (x - lp);
      all += x * x;
      if (i < kickEnd) kick += lp * lp;
    }
    beats.push({ all: all / ((i1 - i0) / 2), kick: kick / ((kickEnd - i0) / 2) });
  }
  if (beats.length < 16) return { downbeat: a.firstBeat, phraseStart: a.firstBeat, bars: [], hook: null };

  // the one: kicks land hardest on it, and the music changes on it
  let best = -1, phase = 0;
  for (let p = 0; p < 4; p++) {
    let s = 0, n = 0;
    for (let i = p; i < beats.length; i += 4) {
      const prev = beats[i - 1]?.all ?? beats[i].all;
      s += Math.sqrt(beats[i].kick) + Math.max(0, Math.sqrt(beats[i].all) - Math.sqrt(prev));
      n++;
    }
    if (s / n > best) { best = s / n; phase = p; }
  }
  const downbeat = a.firstBeat + phase * spb;
  const bars = [];
  for (let i = phase; i + 4 <= beats.length; i += 4) {
    bars.push(Math.sqrt((beats[i].all + beats[i + 1].all + beats[i + 2].all + beats[i + 3].all) / 4));
  }

  // phrases: the 8-bar offset where bar-to-bar energy jumps line up best
  let phraseOff = 0;
  if (bars.length >= 24) {
    best = -1;
    for (let q = 0; q < 8; q++) {
      let s = 0, n = 0;
      for (let j = q || 8; j < bars.length; j += 8) { s += Math.abs(bars[j] - bars[j - 1]); n++; }
      if (n && s / n > best) { best = s / n; phraseOff = q; }
    }
  }
  const phraseStart = downbeat + phraseOff * 4 * spb;

  const sorted = [...bars].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return { downbeat, phraseStart, bars: bars.map(e => e / median) };
}

// Loudest `len`-bar window between two track times, starting on a bar line (returns its start time).
export function loudest(s, spb, from, to, len = 4) {
  const bar = 4 * spb;
  let best = -1, at = null;
  for (let j = Math.max(0, Math.ceil((from - s.downbeat) / bar - 1e-3)); (j + len) * bar + s.downbeat <= to; j++) {
    let e = 0;
    for (let k = 0; k < len; k++) e += s.bars[j + k] ?? 0;
    if (e > best) { best = e; at = s.downbeat + j * bar; }
  }
  return at;
}

// Musical key. The record's notes are found as peaks in its spectrum (peaks that stand out from
// their surroundings, so drums and noise count for little), corrected for the record's tuning,
// folded into the twelve pitch classes and matched against major and minor key profiles.
// Returns a name like "F# minor", or null when no key stands out clearly enough to trust.
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// How strongly each scale degree is expected to sound in a major and a minor key. These are the
// "edma" profiles (Faraldo et al., 2016, as published in Essentia), drawn from dance and pop
// records rather than classical music. On tools/keytest they scored best of five published sets.
const KEY_PROFILES = [[1.0, 0.29, 0.5, 0.4, 0.6, 0.56, 0.32, 0.8, 0.31, 0.45, 0.42, 0.39],
  [1.0, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32]];
// Settings chosen on tools/keytest: notes from 55 Hz to 1300 Hz (higher up is mostly overtones and
// cymbals), peaks at least twice the level around them, and a key is only reported when it
// matches well and beats the best unrelated key by a clear margin.
const KEY_LO = 55, KEY_HI = 1300, KEY_STAND = 2, KEY_MIN = 0.6, KEY_MARGIN = 0.1;

// In-place radix-2 FFT of a complex signal (re, im).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// The record's pitch-class profile: twelve numbers, C to B. Also reports its tuning (in
// semitones from A440, -0.5 to 0.5).
export function chromagram(buffer, from = 0, to = buffer.duration) {
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  // mono at about 11 kHz covers every note that matters here and keeps the frequency steps fine
  const dec = Math.max(1, Math.round(buffer.sampleRate / 11025)), sr = buffer.sampleRate / dec;
  const i0 = Math.max(0, Math.floor(from * buffer.sampleRate));
  const total = Math.floor((Math.min(to, buffer.duration) * buffer.sampleRate - i0) / dec);
  const N = 8192, hop = N / 2, frames = Math.floor((total - N) / hop) + 1;
  if (frames < 4) return null;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2), acc = new Float64Array(N / 2 + 1);
  const bLo = Math.max(2, Math.floor((KEY_LO * N) / sr)), bHi = Math.min(N / 2 - 2, Math.ceil((KEY_HI * N) / sr));
  const peaks = []; // [frame, pitch as a fractional MIDI note, weight]
  for (let f = 0; f < frames; f++) {
    const base = i0 + f * hop * dec;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let d = 0; d < dec; d++) s += (L[base + i * dec + d] + R[base + i * dec + d]) || 0;
      re[i] = s * win[i]; im[i] = 0;
    }
    fft(re, im);
    acc[0] = 0;
    for (let b = 0; b < N / 2; b++) { mag[b] = Math.hypot(re[b], im[b]); acc[b + 1] = acc[b] + mag[b]; }
    for (let b = bLo; b <= bHi; b++) {
      const m = mag[b];
      if (m <= mag[b - 1] || m < mag[b + 1]) continue;
      // the level around this bin, about a third of an octave either side
      const w = Math.max(6, Math.round(b * 0.12)), a = Math.max(0, b - w), z = Math.min(N / 2, b + w + 1);
      const around = (acc[z] - acc[a]) / (z - a);
      if (m < KEY_STAND * around || !around) continue;
      // the true peak lies between bins: fit a parabola through the three highest
      const l = Math.log(mag[b - 1] + 1e-12), c = Math.log(m), r = Math.log(mag[b + 1] + 1e-12);
      const off = (0.5 * (l - r)) / (l - 2 * c + r || 1);
      const hz = ((b + off) * sr) / N;
      peaks.push([f, 69 + 12 * Math.log2(hz / 440), m]);
    }
  }
  if (!peaks.length) return null;
  // tuning: how far the notes sit, on the whole, from the A440 grid
  let sx = 0, sy = 0;
  for (const [, p, w] of peaks) { const a = 2 * Math.PI * (p - Math.round(p)); sx += w * Math.cos(a); sy += w * Math.sin(a); }
  const tuning = Math.atan2(sy, sx) / (2 * Math.PI);
  const chroma = new Float64Array(12), frame = new Float64Array(12);
  let at = 0;
  const flush = () => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += frame[i];
    // each moment counts the same, so one loud bar doesn't decide the key
    if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / sum;
    frame.fill(0);
  };
  for (const [f, p, w] of peaks) {
    if (f !== at) { flush(); at = f; }
    const q = p - tuning, note = Math.round(q), near = Math.cos(Math.PI * (q - note));
    frame[((note % 12) + 12) % 12] += w * near * near; // notes between two pitches count for less
  }
  flush();
  return { chroma, tuning, frames };
}

// Best-matching key for a pitch-class profile, and how far ahead of the best unrelated key it is.
export function matchKey(chroma, profiles = KEY_PROFILES) {
  const corr = (profile, shift) => {
    let mp = 0, mc = 0;
    for (let i = 0; i < 12; i++) { mp += profile[i]; mc += chroma[i]; }
    mp /= 12; mc /= 12;
    let num = 0, dp = 0, dc = 0;
    for (let i = 0; i < 12; i++) {
      const p = profile[i] - mp, c = chroma[(i + shift) % 12] - mc;
      num += p * c; dp += p * p; dc += c * c;
    }
    return num / Math.sqrt(dp * dc || 1);
  };
  const all = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    all.push({ tonic, minor: false, r: corr(profiles[0], tonic) }, { tonic, minor: true, r: corr(profiles[1], tonic) });
  }
  all.sort((a, b) => b.r - a.r);
  const best = all[0];
  // keys that share its notes (relative major/minor, a fifth either side) aren't rivals
  const kin = k => {
    const d = (k.tonic - best.tonic + 12) % 12;
    if (k.minor === best.minor) return d === 0 || d === 7 || d === 5;
    return best.minor ? d === 3 : d === 9;
  };
  const rival = all.find(k => !kin(k));
  return { key: `${NOTES[best.tonic]} ${best.minor ? 'minor' : 'major'}`, r: best.r, margin: best.r - rival.r };
}

export function detectKey(buffer, from = 0, to = buffer.duration) {
  const c = chromagram(buffer, from, to);
  // a record pitched about a quarter tone off sits between two keys and blends with neither
  if (!c || Math.abs(c.tuning) > 0.4) return null;
  const m = matchKey(c.chroma);
  return m.r > KEY_MIN && m.margin > KEY_MARGIN ? m.key : null;
}
