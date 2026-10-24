// Download, decode and analyze a track, then pick where DJPJ will mix in and out of it.
import { analyze } from './analyze.js';

const TARGET_RMS = 0.13;            // loudness every track is matched to
const PLAY_SECONDS = { smooth: 180, club: 135, hype: 90 };

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject); // callback form for older Safari
    if (p?.then) p.then(resolve, reject);
  });
}

function crop(ctx, buf, from, to) {
  const sr = buf.sampleRate;
  const i0 = Math.floor(from * sr), i1 = Math.min(buf.length, Math.floor(to * sr));
  const out = ctx.createBuffer(buf.numberOfChannels, Math.max(1, i1 - i0), sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(i0, i1), ch);
  return out;
}

export async function prepareTrack(track, ctx, { signal, style = 'club' }) {
  if (track.prep) return track;
  if (track.resolve) await track.resolve(signal);
  const res = await fetch(track.url, { signal });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const full = await decode(ctx, await res.arrayBuffer());
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const a = analyze(full, track.bpm);
  const spb = 60 / a.bpm;
  const beatAfter = t => a.firstBeat + Math.ceil((t - a.firstBeat) / spb - 1e-3) * spb;
  const dur = full.duration;

  let inPoint, outPoint;
  if (track.isPreview) {
    inPoint = beatAfter(Math.max(a.start, 0.25));
    outPoint = a.end - 1;
  } else {
    inPoint = beatAfter(a.start);
    // club and hype sets skip long intros to get to the energy
    const skip = style === 'hype' ? 32 : style === 'club' && Math.random() < 0.5 ? 16 : 0;
    if (skip && dur > 150 && inPoint + skip * spb < dur * 0.35) inPoint += skip * spb;
    const len = PLAY_SECONDS[style] * (0.85 + Math.random() * 0.3);
    outPoint = Math.min(inPoint + len, a.end - 6);
  }
  // end on a bar line, counted from the in point
  const bar = 4 * spb;
  outPoint = inPoint + Math.max(4, Math.floor((outPoint - inPoint) / bar)) * bar;
  if (outPoint > a.end) outPoint = Math.max(inPoint + 8, a.end - 0.25);

  // keep a little before the in point (backspins, scratches) and some room to extend the out point
  const from = Math.max(0, inPoint - 5);
  const to = Math.min(dur, outPoint + 30);
  const buffer = crop(ctx, full, from, to);

  track.prep = {
    buffer,
    bpm: a.bpm,
    firstBeat: a.firstBeat - from,
    inPoint: inPoint - from,
    outPoint: outPoint - from,
    maxPoint: Math.min(buffer.duration - 0.5, a.end - from),
    gain: Math.min(4, Math.max(0.25, TARGET_RMS / a.rms)),
    beatSync: track.beatSync && a.confidence > 1.25,
    confidence: a.confidence,
  };
  return track;
}
