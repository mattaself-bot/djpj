// What DJPJ has learned about records he's played: tempo and key, kept in this browser.
// Apple's catalog doesn't say either, so the first play measures them and later sets can pick
// records that beat-match and blend with what's on.
const STORE = 'djpj:tracks', MAX = 1500;

let map = null;
function load() {
  if (map) return map;
  try { map = new Map(Object.entries(JSON.parse(localStorage.getItem(STORE) || '{}'))); } catch { map = new Map(); }
  return map;
}

export function recall(id) {
  const v = load().get(id);
  return v ? { bpm: v[0], key: v[1] || null } : null;
}

export function remember(id, bpm, key) {
  const m = load();
  m.delete(id); // re-insert so the oldest entries are the ones dropped
  m.set(id, [Math.round(bpm * 100) / 100, key || '']);
  while (m.size > MAX) m.delete(m.keys().next().value);
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(m))); } catch { /* private mode or full */ }
}
