// Performance effects: the FX pad buttons (they land on the next beat of the live deck),
// plus the flourishes DJPJ throws in on his own.
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

// Flourishes DJPJ adds on his own. Each one leads into a phrase line, the way DJs work effects:
// in the last beats before a new section, never across the middle of it. No air horns or sirens
// here; those are saved for the set's big moments (see AutoDJ.bigMoment).
const FLAIR = {
  smooth: ['echoThrow', 'filterBuild', 'reverbTail', 'bassOut'],
  club: ['echoThrow', 'filterBuild', 'reverbTail', 'bassOut', 'bassOut', 'rollIn', 'flangerSweep'],
  hype: ['echoThrow', 'bassOut', 'rollIn', 'rollIn', 'gateIn', 'scratchIn', 'filterBuild'],
};
// chance DJPJ throws a flourish into any given phrase line
export const FLAIR_ODDS = { smooth: 0.12, club: 0.25, hype: 0.4 };

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

export function randomFlair(style, last) {
  const list = (FLAIR[style] || FLAIR.club).filter(k => k !== last);
  return list[Math.floor(Math.random() * list.length)];
}

// Schedule flourish `id` so it resolves on phrase line T (audio time) of the live deck.
export function runFlair(id, dj, T) {
  const { engine } = dj;
  const deck = dj.liveDeck();
  if (!deck?.prep) return;
  const b = deck.spb / deck.rateAt(T);
  switch (id) {
    case 'echoThrow': // echo the last beat, the music drops back in dry on the one
      engine.echo.setTime(b * 0.75, T - b);
      at(engine.echo.feedback.gain, 0.5, T - b);
      at(deck.delaySend.gain, 0.8, T - b);
      at(deck.delaySend.gain, 0.8, T - b * 0.5);
      ramp(deck.delaySend.gain, 0, T - b * 0.5 + 0.03);
      break;
    case 'filterBuild':
      at(deck.hp.frequency, 20, T - 4 * b);
      xramp(deck.hp.frequency, 1800, T - 0.02);
      at(deck.hp.frequency, 10, T);
      break;
    case 'reverbTail':
      at(deck.reverbSend.gain, 0, T - b);
      ramp(deck.reverbSend.gain, 0.7, T - 0.05);
      ramp(deck.reverbSend.gain, 0, T + 2 * b);
      break;
    case 'bassOut': // pull the bass for the last bar, slam it back on the one
      at(deck.low.gain, 0, T - 4 * b);
      ramp(deck.low.gain, -30, T - 4 * b + 0.04);
      at(deck.low.gain, -30, T - 0.03);
      ramp(deck.low.gain, 0, T);
      break;
    case 'rollIn':
      deck.loop(T - 2 * b, T - b, deck.spb / 2, deck.posAt(T - 2 * b));
      deck.loop(T - b, T, deck.spb / 4, deck.posAt(T - b));
      break;
    case 'gateIn':
      for (let i = 0; i < 8; i++) {
        at(deck.srcGain.gain, 1, T - 2 * b + (i * b) / 4);
        at(deck.srcGain.gain, 0.05, T - 2 * b + (i * b) / 4 + b / 8);
      }
      at(deck.srcGain.gain, 1, T);
      break;
    case 'scratchIn':
      deck.scratch(T - b, 1);
      break;
    case 'flangerSweep':
      if (engine.flanger.on) break;
      at(engine.flanger.wet.gain, 0, T - 8 * b);
      ramp(engine.flanger.wet.gain, 0.6, T - 6 * b);
      at(engine.flanger.wet.gain, 0.6, T - b);
      ramp(engine.flanger.wet.gain, 0, T);
      break;
  }
}
