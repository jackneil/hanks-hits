import fs from 'node:fs';
const [,, sid] = process.argv;
const base = `http://127.0.0.1:4444/session/${sid}`;
const call = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const ex = (script) => call('/execute/sync', { script, args: [] });
await call('/timeouts', { script: 60000, pageLoad: 60000 });
await call('/url', { url: 'https://hankshits.com/' });
console.log('inject:', await ex('return ' + fs.readFileSync('/tmp/hh-clips/ilab/proto-inject.js', 'utf8').trim()));
const t0 = Date.now(); let last = '';
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const st = await ex("return { s: window.__proto && window.__proto.status, out: (document.getElementById('out')||{}).textContent || '' }");
  const tail = st.out.slice(last.length); if (tail) process.stdout.write(tail.split('\n').map((l) => l.slice(0, 300)).join('\n')); last = st.out;
  if (st.s !== 'running') { console.log('\nSTATUS', st.s); break; }
  if (Date.now() - t0 > 600000) { console.log('TIMEOUT'); break; }
}
const names = await ex('return Object.keys(window.__proto.files)');
const dir = '/tmp/hh-clips/ilab/out/proto-iphone'; fs.mkdirSync(dir, { recursive: true });
for (const n of names) {
  const len = await ex(`const d = window.__proto.files[${JSON.stringify(n)}]; const u = typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer); window.__cur = u; return u.length;`);
  const parts = [];
  for (let o = 0; o < len; o += 700000) parts.push(Buffer.from(await ex(`const u = window.__cur.subarray(${o}, ${o + 700000}); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s);`), 'base64'));
  fs.writeFileSync(`${dir}/${n}`, Buffer.concat(parts)); console.log('pulled', n, len);
}
