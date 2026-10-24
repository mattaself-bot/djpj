// Audius: free, full-length streaming from independent artists. No API key; apps identify via app_name.
// https://docs.audius.org
import { CONFIG } from '../config.js';

const API = 'https://api.audius.co/v1';

async function get(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('app_name', CONFIG.appName);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audius ${res.status}`);
  return (await res.json()).data || [];
}

// Skip gated, deleted and unusually short or long uploads (DJ tools, hour-long mixes).
const playable = t =>
  t.is_streamable !== false && !t.is_stream_gated && !t.is_delete && t.access?.stream !== false &&
  t.duration >= 90 && t.duration <= 600;

export function toTrack(t) {
  return {
    id: 'au:' + t.id,
    source: 'audius',
    title: (t.title || 'Untitled').trim(),
    artist: t.user?.name || 'Unknown artist',
    art: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
    url: `${API}/tracks/${t.id}/stream?app_name=${encodeURIComponent(CONFIG.appName)}`,
    duration: t.duration,
    bpm: t.bpm || null,
    key: t.musical_key || null,
    genre: t.genre,
    year: t.release_date ? new Date(t.release_date).getFullYear() : null,
    link: 'https://audius.co' + t.permalink,
    popularity: t.play_count || 0,
    isPreview: false,
    beatSync: true,
  };
}

export async function trending(genre) {
  const time = ['week', 'month', 'year', 'allTime'][Math.floor(Math.random() * 4)];
  return (await get('/tracks/trending', { genre, time, limit: 100 })).filter(playable).map(toTrack);
}

export async function search(query, limit = 25) {
  return (await get('/tracks/search', { query, limit })).filter(playable).map(toTrack);
}
