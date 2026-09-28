import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const srv = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url).pathname, env: { ...process.env, PORT: '47816' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const udd = '/tmp/hh-clips/chrome-profile-ttfc'; fs.rmSync(udd, { recursive: true, force: true });
const out = [];
const run = async (label, cfg, persistent) => {
  const ctx = persistent ? await chromium.launchPersistentContext(udd, { channel: 'chrome', headless: false }) : null;
  const b = persistent ? null : await chromium.launch({ channel: 'chrome', headless: false });
  const p = persistent ? ctx.pages()[0] || await ctx.newPage() : await b.newPage();
  await p.goto('http://localhost:47816/none');
  const r = await p.evaluate(async (cfg) => {
    const cv = new OffscreenCanvas(cfg.width, cfg.height); const g = cv.getContext('2d');
    let first = null; const t0 = performance.now();
    const enc = new VideoEncoder({ output: () => { if (first === null) first = performance.now() - t0; }, error: (e) => { first = 'err ' + e; } });
    enc.configure({ bitrate: 3e6, framerate: 30, avc: { format: 'avc' }, ...cfg });
    for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${i * 10} 50% 50%)`; g.fillRect(0, 0, cfg.width, cfg.height); const f = new VideoFrame(cv, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i === 0 }); f.close(); }
    await enc.flush();
    return { ttfcMs: typeof first === 'number' ? Math.round(first) : first };
  }, cfg);
  out.push({ label, ...r });
  if (ctx) await ctx.close(); if (b) await b.close();
};
await run('quality-latency 720p High', { codec: 'avc1.640028', width: 1280, height: 720, latencyMode: 'quality' }, false);
await run('realtime 720p Baseline', { codec: 'avc1.42001f', width: 1280, height: 720, latencyMode: 'realtime' }, false);
await run('realtime 640x360 High', { codec: 'avc1.640028', width: 640, height: 360, latencyMode: 'realtime' }, false);
await run('persistent run1 realtime 720p High', { codec: 'avc1.640028', width: 1280, height: 720, latencyMode: 'realtime' }, true);
await run('persistent run2 realtime 720p High', { codec: 'avc1.640028', width: 1280, height: 720, latencyMode: 'realtime' }, true);
console.log(JSON.stringify(out, null, 1));
srv.kill(); fs.rmSync(udd, { recursive: true, force: true });
