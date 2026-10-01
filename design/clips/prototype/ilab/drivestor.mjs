import fs from 'node:fs';
const [,, sid] = process.argv; const base = `http://127.0.0.1:4444/session/${sid}`;
const call = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const ex = (s) => call('/execute/sync', { script: s, args: [] });
await call('/url', { url: 'https://hankshits.com/' });
console.log(await ex('return (' + fs.readFileSync('/tmp/hh-clips/ilab/storage-inject.js', 'utf8').trim() + '\n)'));
for (let i = 0; i < 15; i++) { await new Promise((r) => setTimeout(r, 2000)); const s = await ex('return window.__stor'); if (s.status === 'done') { console.log(JSON.stringify(s.r)); fs.writeFileSync(`/tmp/hh-clips/ilab/out/storage-iphone-se3-${Date.now()}.json`, JSON.stringify(s.r, null, 1)); break; } }
