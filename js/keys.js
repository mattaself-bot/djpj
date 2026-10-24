// Harmonic mixing: map musical keys onto the Camelot wheel so DJPJ can favor keys that blend.

const PITCH = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// Camelot number for each major key, indexed by pitch class (C = 8B, G = 9B, ...)
const MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

export function camelot(key) {
  const m = /^\s*([a-g])\s*(sharp|flat|#|♯|b|♭)?\s*(major|minor|maj|min|m)?/i.exec(key || '');
  if (!m) return null;
  let pc = PITCH[m[1].toLowerCase()];
  const acc = (m[2] || '').toLowerCase();
  if (acc === 'sharp' || acc === '#' || acc === '♯') pc += 1;
  if (acc === 'flat' || acc === 'b' || acc === '♭') pc -= 1;
  pc = (pc + 12) % 12;
  const minor = /^(minor|min|m)$/i.test(m[3] || '');
  // a minor key shares its number with the relative major three semitones up
  return minor ? { n: MAJOR[(pc + 3) % 12], l: 'A' } : { n: MAJOR[pc], l: 'B' };
}

export const camelotLabel = key => {
  const c = camelot(key);
  return c ? `${c.n}${c.l}` : '';
};

export function keysCompatible(a, b) {
  const x = camelot(a), y = camelot(b);
  if (!x || !y) return false;
  if (x.n === y.n) return true; // same key or relative major/minor
  const d = Math.abs(x.n - y.n);
  return x.l === y.l && (d === 1 || d === 11); // one step around the wheel
}
