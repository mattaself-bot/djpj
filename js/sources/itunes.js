// iTunes Search API: the real commercial catalog, but audio is limited to 30-second previews.
// Apple's terms allow previews for promoting the song, so every track links back to its store page.
// https://performance-partners.apple.com/search-api

const API = 'https://itunes.apple.com/search';

export const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/\(.*?\)|\[.*?\]/g, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function query(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ media: 'music', entity: 'song', country: 'US', ...params })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return (await res.json()).results || [];
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
  };
}

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
  return dedupe(res.filter(usable).map(toTrack)).slice(0, limit);
}

export async function byArtist(artist, { clean = false } = {}) {
  const res = await query({ term: artist, attribute: 'artistTerm', limit: 40, ...(clean ? { explicit: 'No' } : {}) });
  const want = norm(artist);
  const mine = res.filter(r => usable(r) && (norm(r.artistName).includes(want) || want.includes(norm(r.artistName))));
  return dedupe(mine.map(toTrack));
}
