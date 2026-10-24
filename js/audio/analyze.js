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
