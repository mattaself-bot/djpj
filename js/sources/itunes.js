// iTunes Search API: the real commercial catalog, but audio is limited to 30-second previews.
// Apple's terms allow previews for promoting the song, so every track links back to its store page.
// https://performance-partners.apple.com/search-api

const API = 'https://itunes.apple.com/search';

export const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/\(.*?\)|\[.*?\]/g, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Apple throttles a visitor after a few dozen calls (a 403 with no CORS headers, so fetch just
// throws). Calls go out one at a time with a gap, and after a refusal nothing more is sent for a
// minute: asking again only keeps the block going. Genres play from catalogs and never come here.
const GAP = 350, COOL_OFF = 60000;
let line = Promise.resolve(), blockedUntil = 0;
export const throttled = () => Date.now() < blockedUntil;

function call(url) {
  const run = async () => {
    if (throttled()) throw new Error('iTunes is rate-limiting this connection');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`iTunes ${res.status}`);
      return (await res.json()).results || [];
    } catch (e) {
      blockedUntil = Date.now() + COOL_OFF;
      throw e;
    } finally {
      await new Promise(r => setTimeout(r, GAP));
    }
  };
  const p = line.then(run, run);
  line = p.catch(() => {});
  return p;
}

function query(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ media: 'music', entity: 'song', country: 'US', ...params })) url.searchParams.set(k, v);
  return call(url);
}

export function toTrack(r) {
  return {
    id: 'it:' + r.trackId,
    source: 'itunes',
    title: r.trackName,
    artist: r.artistName,
    art: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
    url: r.previewUrl,
    duration: 30,
    bpm: null,
    key: null,
    genre: r.primaryGenreName,
    year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : null,
    link: r.trackViewUrl,
    isPreview: true,
    beatSync: true,
    explicit: r.trackExplicitness === 'explicit',
  };
}

// explicit=No already asks Apple for clean versions; double-check each track's own label too
const cleanOk = r => r.trackExplicitness !== 'explicit';
const usable = r => r.kind === 'song' && r.previewUrl && !/\b(live|karaoke|instrumental)\b/i.test(r.trackName);

function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter(t => {
    const k = norm(t.artist) + '|' + norm(t.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function search(term, { limit = 10, clean = false } = {}) {
  const res = await query({ term, limit: limit * 2, ...(clean ? { explicit: 'No' } : {}) });
  return dedupe(res.filter(r => usable(r) && (!clean || cleanOk(r))).map(toTrack)).slice(0, limit);
}

// Fresh preview links for catalog songs, by iTunes track id (one request for the batch).
export async function lookup(ids) {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('country', 'US');
  return (await call(url)).filter(r => r.kind === 'song' && r.previewUrl).map(toTrack);
}

// A catalog song as a playable track. The catalog carries the preview link, so nothing is asked
// of Apple's search; only if that link has gone stale is a fresh one looked up.
export function fromCatalog(s, clean = true) {
  const explicit = !clean && s.explicitId;
  const id = explicit ? s.explicitId : s.cleanId;
  return {
    id: 'it:' + id,
    songKey: s.id, // so exclusions and repeats match however Apple titles the track
    source: 'itunes',
    title: s.title,
    artist: s.artist,
    art: (s.art || '').replace('100x100bb', '600x600bb'),
    url: (explicit ? s.explicitUrl : s.cleanUrl) || null,
    duration: 30,
    bpm: null,
    key: null,
    genre: null,
    year: s.year || null,
    link: `https://music.apple.com/us/song/${id}`,
    isPreview: true,
    beatSync: true,
    explicit: !!explicit,
    async refresh() {
      const [fresh] = await lookup([id]);
      if (!fresh) throw new Error('Preview no longer available');
      this.url = fresh.url;
      this.link = fresh.link || this.link;
    },
  };
}

const artistCache = new Map(); // one search per artist per visit

export async function byArtist(artist, { clean = false } = {}) {
  const k = `${clean}|${artist}`;
  if (!artistCache.has(k)) {
    const res = await query({ term: artist, attribute: 'artistTerm', limit: 40, ...(clean ? { explicit: 'No' } : {}) });
    const want = norm(artist);
    const mine = res.filter(r => usable(r) && (!clean || cleanOk(r)) && (norm(r.artistName).includes(want) || want.includes(norm(r.artistName))));
    artistCache.set(k, dedupe(mine.map(toTrack)));
  }
  return [...artistCache.get(k)];
}
