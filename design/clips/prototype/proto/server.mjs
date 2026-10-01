import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = '/tmp/hh-clips/proto';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const name = (u.searchParams.get('name') || 'blob.bin').replace(/[^A-Za-z0-9_.-]/g, '_');
      fs.writeFileSync(path.join(root, 'out', name), buf);
      console.log('saved', name, buf.length);
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
    });
    return;
  }
  let p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store',
    // mirror prod CSP so the prototype runs under the same policy
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https:; media-src 'self' blob:; worker-src 'self' blob:;" });
  fs.createReadStream(p).pipe(res);
}).listen(8765, '127.0.0.1', () => console.log('listening 8765'));
