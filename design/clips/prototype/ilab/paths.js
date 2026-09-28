// Capture-path lab: measures what recording costs a game on this device.
// Sources: a 2D canvas game and a WebGL game, both at viewport x DPR, like ours.
// Paths:  A = main-thread 2D compositor (drawImage + HUD band) -> VideoFrame -> worker encode
//         B = VideoFrame(webglCanvas) straight to an encoder configured 720x1280 (tests scaling)
//         Bn = VideoFrame(webglCanvas) to an encoder configured at the canvas size
//         D = VideoFrame(gameCanvas) -> worker composites into 720x1280 OffscreenCanvas -> encode
const out = document.getElementById('out');
const stage = document.getElementById('stage');
const log = (s) => { out.textContent += s + '\n'; out.scrollTop = out.scrollHeight; };
const qs = new URLSearchParams(location.search);
const W = 720, H = 1280;

function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
const r2 = (x) => Math.round(x * 100) / 100;

async function measureHz() {
  const d = []; let last = 0;
  await new Promise((res) => { const f = (t) => { if (last) d.push(t - last); last = t; if (d.length < 90) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const med = pct(d.slice(10), 0.5);
  const std = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
  const hz = 1000 / med; let best = std[0]; for (const s of std) if (Math.abs(s - hz) < Math.abs(best - hz)) best = s;
  return { measured: r2(hz), snapped: best };
}

// ---------- games ----------
function sizeCanvas(c) {
  const dpr = Math.min(devicePixelRatio || 1, 3);
  const w = Math.round(stage.clientWidth * dpr / 2) * 2, h = Math.round(stage.clientHeight * dpr / 2) * 2;
  c.width = w; c.height = h; return { w, h, dpr };
}
function make2D() {
  const c = document.createElement('canvas'); stage.appendChild(c); const dims = sizeCanvas(c);
  const ctx = c.getContext('2d');
  const balls = Array.from({ length: 260 }, (_, i) => ({ x: Math.random() * dims.w, y: Math.random() * dims.h, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, r: 6 + Math.random() * 18, h: (i * 37) % 360 }));
  let score = 0;
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 0, dims.h); g.addColorStop(0, '#1e3a8a'); g.addColorStop(1, '#0f172a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, dims.w, dims.h);
    for (const b of balls) {
      b.x += b.vx; b.y += b.vy; if (b.x < 0 || b.x > dims.w) b.vx *= -1; if (b.y < 0 || b.y > dims.h) b.vy *= -1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = `hsl(${b.h},80%,60%)`; ctx.fill();
    }
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(14 * dims.dpr)}px system-ui`;
    for (let i = 0; i < 40; i++) ctx.fillText('brick ' + i, (i * 97) % dims.w, 40 + ((i * 53) % (dims.h - 60)));
    score += 7; ctx.font = `bold ${Math.round(22 * dims.dpr)}px system-ui`; ctx.fillText('Score ' + score, 16 * dims.dpr, 32 * dims.dpr);
  };
  return { canvas: c, draw, dims, kind: '2d', dispose: () => c.remove() };
}
function makeGL(tris = 60000) {
  const c = document.createElement('canvas'); stage.appendChild(c); const dims = sizeCanvas(c);
  const gl = c.getContext('webgl', { antialias: true, preserveDrawingBuffer: false, alpha: false });
  const vs = `attribute vec3 p; uniform float t; varying vec3 v; void main(){ float a=t*0.6; mat3 r=mat3(cos(a),0.,sin(a), 0.,1.,0., -sin(a),0.,cos(a)); vec3 q=r*p; v=p; gl_Position=vec4(q.xy*0.9, q.z*0.5+0.5, 1.0+q.z*0.3); }`;
  const fs = `precision highp float; varying vec3 v; uniform float t; void main(){ float s=0.; for(int i=0;i<24;i++){ s+=sin(v.x*float(i)*3.1+t)*cos(v.y*float(i)*2.3); } gl_FragColor=vec4(0.5+0.5*sin(v*6.+s*.2),1.); }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('GL link failed: ' + gl.getProgramInfoLog(pr)); gl.useProgram(pr);
  const N = tris; const arr = new Float32Array(N * 9);
  for (let i = 0; i < N; i++) { const cx = Math.random() * 2 - 1, cy = Math.random() * 2 - 1, cz = Math.random() * 2 - 1; for (let k = 0; k < 3; k++) { arr[i * 9 + k * 3] = cx + (Math.random() - 0.5) * 0.08; arr[i * 9 + k * 3 + 1] = cy + (Math.random() - 0.5) * 0.08; arr[i * 9 + k * 3 + 2] = cz + (Math.random() - 0.5) * 0.08; } }
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  const tl = gl.getUniformLocation(pr, 't'); gl.enable(gl.DEPTH_TEST); gl.viewport(0, 0, dims.w, dims.h);
  const t0 = performance.now();
  const draw = () => { gl.clearColor(0.05, 0.08, 0.15, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.uniform1f(tl, (performance.now() - t0) / 1000); gl.drawArrays(gl.TRIANGLES, 0, N * 3); };
  draw(); const px = new Uint8Array(4); gl.readPixels(dims.w >> 1, dims.h >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (gl.getError() !== 0 || (px[0] + px[1] + px[2]) === 0) throw new Error('GL game did not render: ' + px.join(','));
  return { canvas: c, draw, dims, kind: 'gl' + (tris === 60000 ? '' : Math.round(tris / 1000) + 'k'), dispose: () => { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); c.remove(); } };
}

// ---------- one run ----------
async function run(worker, game, path, fps, hz, opt = {}) {
  const res = { src: game.kind, path, fps, game: `${game.dims.w}x${game.dims.h}`, lat: opt.lat || qs.get('lat') || 'realtime', enc: null };
  let cfgW = opt.W || W, cfgH = opt.H || H; res.encSize = cfgW + 'x' + cfgH;
  if (path === 'Bn') { cfgW = game.dims.w; cfgH = game.dims.h; }
  const level = (Math.ceil(cfgW / 16) * Math.ceil(cfgH / 16)) * fps > 108000 ? (cfgW * cfgH > 1280 * 720 * 1.01 || fps > 60 ? '28' : '20') : '1f';
  if (path !== 'none') {
    const cfg = { codec: 'avc1.6400' + level, width: cfgW, height: cfgH, bitrate: fps === 60 ? 3500000 : 2500000, bitrateMode: 'variable', framerate: fps, latencyMode: res.lat, avc: { format: 'avc' } };
    res.codec = cfg.codec;
    const ok = await new Promise((resolve) => { worker.onmessage = (e) => { if (e.data.t === 'ready') resolve(true); else if (e.data.t === 'cfgerr') { res.cfgErr = e.data.err; resolve(false); } }; worker.postMessage({ t: 'config', cfg, mode: path === 'D' ? 'D' : 'direct' }); });
    if (!ok) { log(`  ${game.kind} ${path}${fps}: config rejected ${res.cfgErr}`); return res; }
  }
  const comp = path === 'A' ? new OffscreenCanvas(W, H) : null;
  const cctx = comp ? comp.getContext('2d', { alpha: false }) : null;
  let inFlight = 0, drops = 0, captured = 0, capErr = null, slotLast = -1;
  const capCost = [];
  worker.onmessage = (e) => { if (e.data.t === 'consumed') inFlight--; };
  const stride = Math.max(1, Math.ceil(hz / fps));
  const vsync = 1000 / hz;
  const phases = { base: [], cap: [] };
  let phase = 'warm', last = 0, epoch = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const frame = (t) => {
      const el = t - t0;
      phase = el < 1500 ? 'warm' : el < 5000 ? 'base' : el < 12000 ? 'cap' : 'done';
      if (phase === 'done') return resolve();
      game.draw();
      if (last && phase !== 'warm') phases[phase].push(t - last);
      last = t;
      if (phase === 'cap' && path !== 'none') {
        if (!epoch) epoch = t;
        const slot = Math.round((t - epoch) / (stride * vsync));
        if (slot !== slotLast) {
          slotLast = slot;
          if (inFlight >= 2) drops++;
          else {
            const c0 = performance.now();
            try {
              const ts = Math.round(slot * stride * vsync * 1000);
              let vf;
              if (path === 'A') {
                const s = Math.min(W / game.dims.w, (H - 120) / game.dims.h); const w = game.dims.w * s, h = game.dims.h * s;
                cctx.fillStyle = '#0f172a'; cctx.fillRect(0, 0, W, H);
                cctx.drawImage(game.canvas, (W - w) / 2, 120, w, h);
                cctx.fillStyle = '#fff'; cctx.font = 'bold 44px system-ui'; cctx.fillText('Monster Truck  12,400', 32, 76);
                vf = new VideoFrame(comp, { timestamp: ts, duration: Math.round(stride * vsync * 1000), alpha: 'discard' });
              } else {
                vf = new VideoFrame(game.canvas, { timestamp: ts, duration: Math.round(stride * vsync * 1000), alpha: 'discard' });
              }
              worker.postMessage({ t: 'frame', vf }, [vf]); inFlight++; captured++;
            } catch (err) { capErr = String(err && (err.name + ': ' + err.message)); }
            capCost.push(performance.now() - c0);
          }
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const fpsOf = (a) => a.length ? 1000 / (a.reduce((x, y) => x + y, 0) / a.length) : 0;
  res.baseFps = r2(fpsOf(phases.base)); res.capFps = r2(fpsOf(phases.cap));
  res.fpsLossPct = res.baseFps ? r2(100 * (1 - res.capFps / res.baseFps)) : null;
  res.baseP95 = r2(pct(phases.base, 0.95)); res.capP95 = r2(pct(phases.cap, 0.95));
  res.longFramesPct = r2(100 * phases.cap.filter((d) => d > 1.5 * vsync).length / Math.max(1, phases.cap.length));
  res.capCostP50 = r2(pct(capCost, 0.5)); res.capCostP95 = r2(pct(capCost, 0.95)); res.capCostMax = r2(pct(capCost, 1));
  res.captured = captured; res.dropsInFlight = drops; res.capErr = capErr; res.captureFps = r2(captured / 7);
  if (path !== 'none') {
    const st = await new Promise((resolve) => { worker.onmessage = (e) => { if (e.data.t === 'stats') resolve(e.data.stats); else if (e.data.t === 'consumed') inFlight--; }; worker.postMessage({ t: 'finish' }); });
    res.enc = st;
  }
  log(`  ${game.kind} ${path}${path === 'none' ? '' : fps} ${res.lat[0]} ${res.encSize}: base ${res.baseFps}fps cap ${res.capFps}fps loss ${res.fpsLossPct}% | cost p50 ${res.capCostP50}ms p95 ${res.capCostP95}ms | in ${captured} out ${res.enc ? res.enc.outputs : '-'} sub ${res.enc ? res.enc.submitted : '-'} ttfc ${res.enc ? r2(res.enc.ttfcMs) : '-'}ms err ${(res.enc && res.enc.errors.length) || capErr || 0} ooo ${res.enc ? res.enc.outOfOrder : '-'} ${res.enc ? JSON.stringify(res.enc.deltaTypes) : ''}`);
  return res;
}

async function runAll() {
  document.getElementById('run').disabled = true;
  let wake = null; try { wake = await navigator.wakeLock.request('screen'); } catch (e) { log('wakeLock: ' + e); }
  const results = { ua: navigator.userAgent, when: new Date().toISOString(), dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, stage: `${stage.clientWidth}x${stage.clientHeight}`, lat: qs.get('lat') || 'realtime', runs: [] };
  const hz = await measureHz(); results.hz = hz; log('display ' + JSON.stringify(hz) + ' dpr ' + devicePixelRatio + ' ua ' + navigator.userAgent);
  const worker = new Worker('enc-worker.js');
  const plans = {
    base: [['2d', 'none', 30], ['2d', 'A', 30], ['2d', 'D', 30], ['2d', 'A', 60], ['2d', 'D', 60], ['gl', 'none', 30], ['gl', 'A', 30], ['gl', 'B', 30], ['gl', 'Bn', 30], ['gl', 'D', 30]],
    gl2: [['gl', 'none', 30], ['gl', 'B', 30, { lat: 'realtime' }], ['gl', 'B', 30, { lat: 'quality' }], ['gl', 'D', 30, { lat: 'quality' }], ['gl', 'D', 20, { lat: 'realtime' }], ['gl', 'D', 30, { lat: 'realtime', W: 540, H: 960 }],
          ['gl15k', 'none', 30], ['gl15k', 'B', 30, { lat: 'realtime' }], ['gl15k', 'D', 30, { lat: 'realtime' }], ['gl15k', 'D', 30, { lat: 'quality' }]],
    q: [['2d', 'D', 30, { lat: 'quality' }], ['2d', 'D', 60, { lat: 'quality' }], ['2d', 'A', 30, { lat: 'quality' }], ['gl15k', 'D', 30, { lat: 'quality' }], ['gl15k', 'B', 30, { lat: 'quality' }], ['gl', 'D', 30, { lat: 'quality' }]],
  };
  const plan = plans[qs.get('plan') || 'base'];
  let game = null;
  for (const [src, path, fps, opt] of plan) {
    if (!game || game.kind !== src) { if (game) game.dispose(); game = src === '2d' ? make2D() : makeGL(src === 'gl15k' ? 15000 : 60000); await new Promise((r) => setTimeout(r, 300)); }
    try { results.runs.push(await run(worker, game, path, fps, hz.snapped, opt || {})); }
    catch (err) { log('run error ' + err); results.runs.push({ src, path, fps, fatal: String(err) }); }
  }
  if (game) game.dispose();
  worker.terminate();
  try { await fetch('/r?name=' + encodeURIComponent('paths-' + (qs.get('tag') || 'iphone') + '-' + Date.now() + '.json'), { method: 'POST', body: JSON.stringify(results, null, 1) }); log('uploaded'); } catch (e) { log('upload failed ' + e); }
  try { wake && wake.release(); } catch {}
  log('DONE'); document.title = 'DONE';
  document.getElementById('run').disabled = false;
}

document.getElementById('run').onclick = () => runAll().catch((e) => log('FATAL ' + (e.stack || e)));
document.getElementById('probe').onclick = () => { location.href = '/probe'; };
document.getElementById('proto').onclick = () => { location.href = '/proto/?tag=' + (qs.get('tag') || 'iphone') + '&secs=30'; };
if (qs.get('auto') === '1') runAll().catch((e) => log('FATAL ' + (e.stack || e)));
