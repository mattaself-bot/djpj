// Performance effects: the FX pad buttons, plus the occasional flourish DJPJ throws in on his own.
// Everything lands on the next beat of the live deck.
import { at, ramp, xramp, hold } from './engine.js';

export const FX_LIST = [
  { id: 'airhorn', label: 'Air horn', icon: '📯' },
  { id: 'scratch', label: 'Scratch', icon: '💿' },
  { id: 'echo', label: 'Echo', icon: '🔁' },
  { id: 'reverb', label: 'Reverb', icon: '🌊' },
  { id: 'filter', label: 'Filter sweep', icon: '🎚️' },
  { id: 'roll', label: 'Beat roll', icon: '🥁' },
  { id: 'gate', label: 'Gate chop', icon: '✂️' },
  { id: 'boom', label: 'Drop boom', icon: '💥' },
  { id: 'flanger', label: 'Flanger', icon: '🌀', toggle: true },
  { id: 'phaser', label: 'Phaser', icon: '🪐', toggle: true },
  { id: 'bass', label: 'Bass kill', icon: '🔇', toggle: true },
  { id: 'riser', label: 'Riser', icon: '🚀' },
  { id: 'laser', label: 'Laser', icon: '⚡' },
  { id: 'siren', label: 'Siren', icon: '🚨' },
  { id: 'spin', label: 'Backspin → next', icon: '⏪' },
  { id: 'brake', label: 'Brake → next', icon: '🛑' },
];

const FLAIR = {
  smooth: ['echo', 'filter', 'reverb'],
  club: ['echo', 'filter', 'reverb', 'roll', 'flangerSweep', 'airhorn'],
  hype: ['airhorn', 'airhorn', 'scratch', 'roll', 'laser', 'siren', 'gate', 'echo', 'boom'],
};
export const FLAIR_GAP = { smooth: 70, club: 32, hype: 14 }; // minimum seconds between flourishes

function nextBeat(deck, now, div = 1) {
  if (!deck?.isPlaying(now + 0.05)) return now + 0.03;
  return deck.timeAt(deck.beatAfter(deck.posAt(now + 0.04), div));
}

export function runFX(id, dj) {
  const { engine, sfx } = dj;
  const now = engine.ctx.currentTime;
  const deck = dj.liveDeck();
  const t = nextBeat(deck, now);
  const b = deck?.prep ? deck.spb / deck.rateAt(t) : 0.5; // real seconds per beat

  switch (id) {
    case 'airhorn': sfx.airhorn(t); break;
    case 'boom': sfx.impact(t); break;
    case 'laser': sfx.laser(t); break;
    case 'siren': sfx.siren(t); break;
    case 'riser':
      sfx.riser(t, 8 * b);
      sfx.impact(t + 8 * b);
      break;
    case 'scratch': deck?.scratch(t, 1); break;
    case 'echo':
      if (!deck) break;
      engine.echo.setTime(b * 0.75, t);
      hold(deck.delaySend.gain, t);
      at(deck.delaySend.gain, 0.85, t);
      at(deck.delaySend.gain, 0.85, t + b * 0.5);
      ramp(deck.delaySend.gain, 0, t + b * 0.5 + 0.03);
      break;
    case 'reverb':
      if (!deck) break;
      hold(deck.reverbSend.gain, t);
      ramp(deck.reverbSend.gain, 0.8, t + b * 0.5);
      ramp(deck.reverbSend.gain, 0, t + b * 4);
      break;
    case 'filter':
      if (!deck) break;
      hold(deck.hp.frequency, t);
      at(deck.hp.frequency, 20, t);
      xramp(deck.hp.frequency, 3000, t + b * 4);
      at(deck.hp.frequency, 10, t + b * 4); // snap back on the downbeat
      break;
    case 'roll':
      if (deck) deck.loop(t, t + 2 * b, deck.spb / 4);
      break;
    case 'gate':
      if (!deck) break;
      for (let i = 0; i < 16; i++) {
        at(deck.srcGain.gain, 1, t + (i * b) / 4);
        at(deck.srcGain.gain, 0.05, t + (i * b) / 4 + b / 8);
      }
      at(deck.srcGain.gain, 1, t + 4 * b);
      break;
    case 'flangerSweep':
      if (engine.flanger.on) break;
      at(engine.flanger.wet.gain, 0, t);
      ramp(engine.flanger.wet.gain, 0.6, t + b);
      at(engine.flanger.wet.gain, 0.6, t + 7 * b);
      ramp(engine.flanger.wet.gain, 0, t + 8 * b);
      break;
    case 'flanger':
      engine.flanger.set(!engine.flanger.on, now);
      return engine.flanger.on;
    case 'phaser':
      engine.phaser.set(!engine.phaser.on, now);
      return engine.phaser.on;
    case 'bass':
      if (!deck) return false;
      dj.bassKill = !dj.bassKill;
      hold(deck.low.gain, now);
      ramp(deck.low.gain, dj.bassKill ? -40 : 0, now + 0.05);
      return dj.bassKill;
    case 'spin':
    case 'brake':
      dj.skip(id);
      break;
  }
  return undefined;
}

export function randomFlair(style) {
  const list = FLAIR[style] || FLAIR.club;
  return list[Math.floor(Math.random() * list.length)];
}
