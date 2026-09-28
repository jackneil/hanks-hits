const tag = new URLSearchParams(location.search).get('tag') || 'vf';
const W = 1280, H = 720;
const el = document.getElementById('c'); const ectx = el.getContext('2d', { alpha: false });
const oc = new OffscreenCanvas(W, H); const octx = oc.getContext('2d', { alpha: false });
const worker = new Worker(URL.createObjectURL(new Blob([`onmessage=e=>{const f=e.data; if(f&&f.close) f.close(); else if (f && f.close===undefined && f.width) f.close && f.close(); postMessage(1)}`], { type: 'text/javascript' })));
const draw = (ctx, i) => { ctx.fillStyle = '#' + ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0'); ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = '64px sans-serif'; ctx.fillText('f' + i, 40, 90); ctx.fillRect((i * 13) % W, (i * 7) % H, 120, 120); };
const raf = () => new Promise(r => requestAnimationFrame(r));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(p * (s.length - 1))].toFixed(3); };
async function bench(name, fn, n = 120) {
  const t = [];
  for (let i = 0; i < n; i++) { await raf(); const r = await fn(i); t.push(r); }
  return { name, p50: pct(t, .5), p95: pct(t, .95), max: pct(t, 1) };
}
(async () => {
  const res = { ua: navigator.userAgent, r: [] };
  res.r.push(await bench('VideoFrame(OffscreenCanvas)+transfer', i => { draw(octx, i); const t = performance.now(); const f = new VideoFrame(oc, { timestamp: i * 33333, alpha: 'discard' }); worker.postMessage(f, [f]); return performance.now() - t; }));
  res.r.push(await bench('VideoFrame(HTMLCanvas)+transfer', i => { draw(ectx, i); const t = performance.now(); const f = new VideoFrame(el, { timestamp: i * 33333, alpha: 'discard' }); worker.postMessage(f, [f]); return performance.now() - t; }));
  res.r.push(await bench('createImageBitmap(HTMLCanvas) sync part', async i => { draw(ectx, i); const t = performance.now(); const p = createImageBitmap(el); const dt = performance.now() - t; const b = await p; worker.postMessage(b, [b]); return dt; }));
  res.r.push(await bench('OffscreenCanvas.transferToImageBitmap+transfer', i => { draw(octx, i); const t = performance.now(); const b = oc.transferToImageBitmap(); worker.postMessage(b, [b]); return performance.now() - t; }));
  res.r.push(await bench('draw only (baseline)', i => { const t = performance.now(); draw(octx, i); return performance.now() - t; }));
  await fetch('/upload?name=' + tag + '-results.json', { method: 'POST', body: JSON.stringify(res, null, 1) });
  document.getElementById('o').textContent = JSON.stringify(res, null, 1) + '\nDONE'; document.title = 'DONE';
})().catch(async e => { await fetch('/upload?name=' + tag + '-results.json', { method: 'POST', body: 'FATAL ' + (e.stack || e) }); document.title = 'FATAL'; });
