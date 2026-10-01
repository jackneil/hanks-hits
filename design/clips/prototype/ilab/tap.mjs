// Tap the visible part of a button (trusted touch via W3C actions), then report what's on screen.
import fs from 'node:fs';
const [,, sid, pattern = 'Play', shot = 'after-tap'] = process.argv; const base = `http://127.0.0.1:4444/session/${sid}`;
const call = async (p, body, method) => { const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const pt = await call('/execute/sync', { args: [pattern], script: `const re = new RegExp(arguments[0]); const b = [...document.querySelectorAll('button')].filter(x => re.test(x.textContent) && x.offsetParent).pop(); if (!b) return null; const r = b.getBoundingClientRect(); const top = Math.max(r.top, 0), bot = Math.min(r.bottom, innerHeight); return { x: Math.round(r.left + r.width / 2), y: Math.round((top + bot) / 2), rect: [r.left, r.top, r.width, r.height].map(Math.round), vh: innerHeight, text: b.textContent.trim() };` });
console.log('target', JSON.stringify(pt));
if (pt) {
  await call('/actions', { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: pt.x, y: pt.y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 }] }] });
  await call('/actions', null, 'DELETE');
}
await new Promise((r) => setTimeout(r, 4000));
const png = await call('/screenshot'); fs.writeFileSync(`/tmp/hh-clips/ilab/out/${shot}.png`, Buffer.from(png, 'base64'));
console.log('state', JSON.stringify(await call('/execute/sync', { args: [], script: `let m = 0; const f = (d) => { for (const c of d.querySelectorAll('canvas')) m = Math.max(m, c.width * c.height); }; f(document); for (const i of document.querySelectorAll('iframe')) { try { f(i.contentDocument); } catch {} } return { biggestCanvas: m, iframes: document.querySelectorAll('iframe').length, playVisible: [...document.querySelectorAll('button')].some(b => /Play/.test(b.textContent) && b.offsetParent) };` })));
