import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const srv = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url).pathname, env: { ...process.env, PORT: '47815' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const results = [];
for (const [channel, hw, warm] of [['chrome', 'prefer-software', false], ['chrome', 'no-preference', false], ['chrome', 'prefer-hardware', false], ['chrome', 'no-preference', true], [undefined, 'no-preference', false]]) {
  const b = await chromium.launch({ channel, headless: false });
  const p = await b.newPage();
  await p.goto('http://localhost:47815/none');
  const r = await p.evaluate(async ({ hw, warm }) => {
    const t00 = performance.now();
    let warmMs = null;
    if (warm) {
      // Warm-up: a throwaway 64x64 encoder at page load, closed after its first output.
      await new Promise((res) => { const e = new VideoEncoder({ output: () => { e.close(); res(); }, error: () => res() }); e.configure({ codec: 'avc1.42001f', width: 64, height: 64, bitrate: 100000, framerate: 30 }); const c = new OffscreenCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64); const f = new VideoFrame(c, { timestamp: 0 }); e.encode(f, { keyFrame: true }); f.close(); e.flush().catch(() => {}); });
      warmMs = Math.round(performance.now() - t00);
    }
    const cv = new OffscreenCanvas(1280, 720); const g = cv.getContext('2d');
    let first = null; const t0 = performance.now(); let n = 0;
    const enc = new VideoEncoder({ output: () => { n++; if (first === null) first = performance.now() - t0; }, error: (e) => { first = 'err ' + e; } });
    enc.configure({ codec: 'avc1.640028', width: 1280, height: 720, bitrate: 3e6, framerate: 30, latencyMode: 'realtime', hardwareAcceleration: hw, avc: { format: 'avc' } });
    for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${i * 10} 50% 50%)`; g.fillRect(0, 0, 1280, 720); const f = new VideoFrame(cv, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i === 0 }); f.close(); }
    await enc.flush();
    return { hw, warm, warmMs, ttfcMs: typeof first === 'number' ? Math.round(first) : first, totalMs: Math.round(performance.now() - t0), n };
  }, { hw, warm });
  results.push({ browser: b.version(), ...r });
  await b.close();
}
console.log(JSON.stringify(results, null, 1));
srv.kill();
