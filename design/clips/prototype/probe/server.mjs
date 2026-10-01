// Scratch capability-probe server for the Hank's Hits clips feature.
// Serves the probe page with the SAME security headers production sends
// (apps/web/next.config.ts:17-38) so the probe exercises the real CSP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.dirname(new URL(import.meta.url).pathname);
const nm = path.join(root, '..', 'node_modules');
const PORT = Number(process.env.PORT || 47811);
const files = {
  '/': [path.join(root, 'probe.html'), 'text/html'],
  '/probe.js': [path.join(root, 'probe.js'), 'text/javascript'],
  '/worker.js': [path.join(root, 'worker.js'), 'text/javascript'],
  '/worklet.js': [path.join(root, 'worklet.js'), 'text/javascript'],
  '/mediabunny.mjs': [path.join(nm, 'mediabunny/dist/bundles/mediabunny.min.mjs'), 'text/javascript'],
  '/aac.mjs': [path.join(nm, '@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.min.mjs'), 'text/javascript'],
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none';";
const sec = { 'Content-Security-Policy': CSP, 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
function ffprobe(p) {
  try { return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-count_frames', '-of', 'json', p], { encoding: 'utf8', timeout: 30000 })); }
  catch (e) { return { error: String(e.stderr || e.message).slice(0, 800) }; }
}
function atoms(p) {
  const b = fs.readFileSync(p); const out = []; let o = 0;
  while (o + 8 <= b.length && out.length < 20) { let sz = b.readUInt32BE(o); const t = b.toString('latin1', o + 4, o + 8); if (sz === 1) sz = Number(b.readBigUInt64BE(o + 8)); out.push(t + ':' + sz); if (sz < 8) break; o += sz; }
  return out;
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const label = (u.searchParams.get('label') || 'unknown').replace(/[^\w.-]/g, '_');
      const buf = Buffer.concat(chunks);
      if (u.pathname === '/result') {
        fs.writeFileSync(path.join(root, 'results', label + '.json'), buf);
        res.writeHead(200, sec); res.end('ok'); console.log('result', label, buf.length);
      } else if (u.pathname === '/clip') {
        const name = (u.searchParams.get('name') || 'clip').replace(/[^\w.-]/g, '_');
        const p = path.join(root, 'results', `${label}-${name}`);
        fs.writeFileSync(p, buf);
        const report = { bytes: buf.length, atoms: atoms(p), ffprobe: ffprobe(p) };
        fs.writeFileSync(p + '.ffprobe.json', JSON.stringify(report, null, 1));
        res.writeHead(200, { ...sec, 'Content-Type': 'application/json' }); res.end(JSON.stringify(report)); console.log('clip', label, name, buf.length);
      } else { res.writeHead(404); res.end(); }
    }); return;
  }
  const f = files[u.pathname];
  if (!f) { res.writeHead(404, sec); res.end('nf'); return; }
  res.writeHead(200, { ...sec, 'Content-Type': f[1] }); fs.createReadStream(f[0]).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('probe server on', PORT));
