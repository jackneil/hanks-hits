// WebDriver driver: opens hankshits.com on the USB iPhone, injects the lab, polls, saves results.
import fs from 'node:fs';
const [,, sid, script = '/tmp/hh-clips/ilab/inject.js', tag = 'iphone-se3', url = 'https://hankshits.com/'] = process.argv;
const base = `http://127.0.0.1:4444/session/${sid}`;
const call = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
await call('/timeouts', { script: 30000, pageLoad: 60000 });
await call('/url', { url });
console.log('loaded', await call('/url'));
await call('/execute/sync', { script: 'window.__labParams = ' + JSON.stringify(process.env.LAB_PARAMS || '') + '; return 1', args: [] }); console.log('inject:', await call('/execute/sync', { script: 'return ' + fs.readFileSync(script, 'utf8').trim(), args: [] }));
let seen = 0; const t0 = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const st = await call('/execute/sync', { script: 'return window.__lab ? { status: window.__lab.status, log: window.__lab.log, error: window.__lab.error } : null', args: [] });
  if (!st) { console.log('no lab state (page navigated?)'); break; }
  const lines = st.log.split('\n'); process.stdout.write(lines.slice(seen).filter(Boolean).map((l) => l + '\n').join('')); seen = Math.max(seen, lines.length - 1);
  if (st.status !== 'running') { console.log('STATUS', st.status, st.error || ''); break; }
  if (Date.now() - t0 > 420000) { console.log('TIMEOUT'); break; }
}
const res = await call('/execute/sync', { script: 'return window.__lab && window.__lab.results', args: [] });
if (res) { const f = `/tmp/hh-clips/ilab/out/paths-${tag}-${Date.now()}.json`; fs.writeFileSync(f, JSON.stringify(res, null, 1)); console.log('saved', f); }
