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

// Musical key, from which notes carry the most energy (a chromagram matched against the
// Krumhansl-Kessler major and minor profiles). Returns a name like "F# minor", or null when
// nothing stands out (drums only, or a record that's out of tune with A440).
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(buffer, from = 0, to = buffer.duration) {
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  // mono at about 11 kHz is plenty for the notes used here, C3 to B5
  const dec = Math.max(1, Math.round(buffer.sampleRate / 11025)), sr = buffer.sampleRate / dec;
  const N = 4096, maxFrames = 32;
  const i0 = Math.floor(from * buffer.sampleRate), total = Math.floor(((to - from) * buffer.sampleRate) / dec);
  const frames = Math.min(maxFrames, Math.floor(total / N));
  if (frames < 4) return null;
  const stride = Math.floor(total / frames); // frames spread across the whole stretch
  const win = new Float32Array(N), x = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const coeffs = [];
  for (let midi = 48; midi < 84; midi++) coeffs.push(2 * Math.cos((2 * Math.PI * 440 * Math.pow(2, (midi - 69) / 12)) / sr));
  const chroma = new Float64Array(12);
  for (let f = 0; f < frames; f++) {
    const base = i0 + f * stride * dec;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let d = 0; d < dec; d++) s += (L[base + i * dec + d] + R[base + i * dec + d]) || 0;
      x[i] = s * win[i];
    }
    coeffs.forEach((c, k) => { // Goertzel: the energy at one note's frequency
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
      chroma[k % 12] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
    });
  }
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
  let best = -1, name = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [profile, mode] of [[MAJOR, 'major'], [MINOR, 'minor']]) {
      const r = corr(profile, tonic);
      if (r > best) { best = r; name = `${NOTES[tonic]} ${mode}`; }
    }
  }
  return best > 0.55 ? name : null;
}
