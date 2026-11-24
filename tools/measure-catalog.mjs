// Measures the tempo and key of every catalog song and saves them in data/catalog/<genre>.json,
// so DJPJ can pick records that beat-match and blend before he has ever played them.
//
//   node tools/measure-catalog.mjs          then open http://localhost:5174/tools/measure/
//
// The measuring itself needs a browser (it decodes Apple's previews with the same code the site
// uses), so this script only serves the repo and writes down what the page reports. Nothing is
// played aloud. Songs already measured are skipped; add ?redo to the page address to measure
// them all again (after changing the detector, say).
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5174;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const fileFor = key => join(ROOT, 'data', 'catalog', `${key}.json`);

let line = Promise.resolve(); // one save at a time, so two batches never overwrite each other
async function save({ genre, version, results }) {
  if (!/^[a-z0-9-]+$/.test(genre)) throw new Error('bad genre');
  const cat = JSON.parse(await readFile(fileFor(genre), 'utf8'));
  let n = 0;
  for (const s of cat.songs) {
    const r = results[s.cleanId];
    if (!r) continue;
    delete s.bpm; delete s.key;
    if (r[0]) s.bpm = r[0];
    if (r[1]) s.key = r[1];
    s.measured = version;
    n++;
  }
  await writeFile(fileFor(genre), JSON.stringify(cat, null, 1) + '\n');
  return n;
}

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/save') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const job = line.then(() => save(JSON.parse(body)));
      line = job.catch(() => {});
      const n = await job;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ saved: n }));
      return;
    }
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('\\') || path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('outside the repo');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 500);
    res.end(String(e.message));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Open http://localhost:${PORT}/tools/measure/`));
