// Injected into a real hankshits.com game page. Installs a requestAnimationFrame
// dispatcher (the plan's zero-code auto-discovery), finds the largest canvas, and
// measures the game's frame rate with capture off, then with capture on
// (path D, latencyMode 'quality', 30 fps target). No network, results stay in window.__gcap.
(() => {
  if (window.__gcap && window.__gcap.status === 'running') return 'already running';
  const params = new URLSearchParams(window.__labParams || '');
  const FPS = Number(params.get('fps') || 30), LAT = params.get('lat') || 'quality', PATH = params.get('path') || 'D';
  const BASE_MS = Number(params.get('base') || 6000), CAP_MS = Number(params.get('cap') || 10000), POST_MS = Number(params.get('post') || 0);
  const W = 720, H = 1280;
  const S = (window.__gcap = { status: 'running', log: '', result: null });
  const log = (s) => { S.log += s + '\n'; };
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const r2 = (x) => Math.round(x * 100) / 100;
  const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.width * c.height > 0);
  // also look inside same-origin iframes
  for (const f of document.querySelectorAll('iframe')) { try { canvases.push(...[...f.contentDocument.querySelectorAll('canvas')].filter((c) => c.width * c.height > 0)); } catch {} }
  if (!canvases.length) { S.status = 'error'; S.log += 'no canvas\n'; return 'no canvas'; }
  const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const win = canvas.ownerDocument.defaultView;
  const glType = (() => { try { return canvas.getContext('webgl2') ? 'webgl2' : canvas.getContext('webgl') ? 'webgl' : '2d'; } catch { return '?'; } })();
  log(`canvas ${canvas.width}x${canvas.height} (${glType}) in ${win === window ? 'page' : 'iframe'}; canvases=${canvases.length}`);

  // ---- rAF dispatcher: game callbacks first, then capture, same task ----
  const nativeRAF = win.requestAnimationFrame.bind(win), nativeCAF = win.cancelAnimationFrame.bind(win);
  let queue = [], scheduled = false, nextId = 1e9; const cancelled = new Set();
  win.requestAnimationFrame = (cb) => { const id = nextId++; queue.push([id, cb]); if (!scheduled) { scheduled = true; nativeRAF(dispatch); } return id; };
  win.cancelAnimationFrame = (id) => { if (id >= 1e9) cancelled.add(id); else nativeCAF(id); };
  const intervals = { base: [], cap: [], post: [] }; const capCost = []; let lastT = 0, phase = 'warm', t0 = 0;
  let inFlight = 0, captured = 0, drops = 0, slotLast = -1, epoch = 0, capErr = null, dispatches = 0;
  const vsync = 1000 / 60, stride = Math.max(1, Math.ceil(60 / FPS));
  function dispatch(t) {
    scheduled = false; dispatches++;
    const q = queue; queue = [];
    if (PATH === 'P') afterFrame(t);   // capture the already-presented previous frame, before the game draws
    for (const [id, cb] of q) { if (cancelled.delete(id)) continue; try { cb(t); } catch (e) { setTimeout(() => { throw e; }); } }
    if (PATH !== 'P') afterFrame(t);
  }
  const worker = new Worker(URL.createObjectURL(new Blob([__WSRC__], { type: 'text/javascript' })));
  worker.onmessage = (e) => { if (e.data.t === 'consumed') inFlight--; };
  // ---- path E: async GPU readback on the game's own WebGL2 context ----
  let E = null, eErr = null, ePendingMax = 0, eReady = 0, eNotReady = 0;
  const eCost = [], ePollCost = [];
  function setupE() {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('path E needs WebGL2');
    const SW = canvas.width, SH = canvas.height;
    const CW = 640, CH = Math.max(2, Math.round(640 * SH / SW / 2) * 2);
    const mk = (w, h) => { const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb); return fb; };
    const save = () => ({ fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), rfb: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), dfb: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), rb: gl.getParameter(gl.RENDERBUFFER_BINDING), pack: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), scissor: gl.isEnabled(gl.SCISSOR_TEST), discard: gl.isEnabled(gl.RASTERIZER_DISCARD), align: gl.getParameter(gl.PACK_ALIGNMENT) });
    const restore = (st) => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, st.rfb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.dfb); gl.bindRenderbuffer(gl.RENDERBUFFER, st.rb); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, st.pack); if (st.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST); if (st.discard) gl.enable(gl.RASTERIZER_DISCARD); else gl.disable(gl.RASTERIZER_DISCARD); gl.pixelStorei(gl.PACK_ALIGNMENT, st.align); };
    const st0 = save();
    const full = mk(SW, SH), small = mk(CW, CH);
    const slots = [0, 1, 2, 3].map(() => { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, CW * CH * 4, gl.STREAM_READ); return { b, sync: null, ts: 0, dur: 0 }; });
    restore(st0);
    E = { gl, SW, SH, CW, CH, full, small, slots, save, restore, next: 0 };
    log(`path E ready: ${SW}x${SH} -> ${CW}x${CH}, antialias=${gl.getContextAttributes().antialias}`);
  }
  function kickE(ts, dur) {  // same task as the game's render: GPU-only work, no waits
    const { gl } = E; const slot = E.slots[E.next % E.slots.length];
    if (slot.sync) { return false; }  // all slots busy: drop (counted by caller)
    E.next++;
    const st = E.save();
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, E.full);
    gl.blitFramebuffer(0, 0, E.SW, E.SH, 0, 0, E.SW, E.SH, gl.COLOR_BUFFER_BIT, gl.NEAREST);        // resolve (same size; legal from a multisampled default buffer)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, E.full); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, E.small);
    gl.blitFramebuffer(0, 0, E.SW, E.SH, 0, E.CH, E.CW, 0, gl.COLOR_BUFFER_BIT, gl.LINEAR);          // scale + flip rows
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, E.small); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.b); gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.readPixels(0, 0, E.CW, E.CH, gl.RGBA, gl.UNSIGNED_BYTE, 0);                                     // async into the PBO
    slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); slot.ts = ts; slot.dur = dur;
    E.restore(st);
    const err = gl.getError(); if (err && !eErr) eErr = 'glError ' + err;
    return true;
  }
  function pollE() {  // every frame: collect finished readbacks without waiting
    const { gl } = E; let pending = 0;
    for (const slot of E.slots) {
      if (!slot.sync) continue;
      const r = gl.clientWaitSync(slot.sync, 0, 0);
      if (r === gl.TIMEOUT_EXPIRED) { pending++; eNotReady++; continue; }
      gl.deleteSync(slot.sync); slot.sync = null; eReady++;
      const px = new Uint8Array(E.CW * E.CH * 4);
      const st = E.save(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.b); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px); E.restore(st);
      if (inFlight >= 2) { drops++; continue; }
      if (eReady === 45 || eReady === 150) { try { const c = new OffscreenCanvas(E.CW, E.CH); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0)), E.CW, E.CH), 0, 0); c.convertToBlob({ type: 'image/png' }).then((bl) => { const fr = new FileReader(); fr.onload = () => { (S.snaps = S.snaps || []).push(fr.result); }; fr.readAsDataURL(bl); }); } catch (e) { eErr = eErr || 'snap ' + e; } }
      const vf = new VideoFrame(px, { format: 'RGBA', codedWidth: E.CW, codedHeight: E.CH, timestamp: slot.ts, duration: slot.dur });
      worker.postMessage({ t: 'frame', vf }, [vf]); inFlight++; captured++;
    }
    ePendingMax = Math.max(ePendingMax, pending);
  }
  function afterFrame(t) {
    if (!t0) t0 = t;
    const el = t - t0;
    phase = el < 1500 ? 'warm' : el < 1500 + BASE_MS ? 'base' : el < 1500 + BASE_MS + CAP_MS ? 'cap' : el < 1500 + BASE_MS + CAP_MS + 1000 ? 'gap' : el < 1500 + BASE_MS + CAP_MS + 1000 + POST_MS ? 'post' : 'done';
    if (lastT && (phase === 'base' || phase === 'cap' || phase === 'post')) intervals[phase].push(t - lastT);
    lastT = t;
    if (phase === 'done' && S.status === 'running') { finish(); return; }
    if (PATH === 'E' && E && (phase === 'cap' || phase === 'gap')) { const p0 = performance.now(); try { pollE(); } catch (e) { eErr = eErr || String(e); } ePollCost.push(performance.now() - p0); }
    if (phase !== 'cap') return;
    if (!epoch) epoch = t;
    const slot = Math.round((t - epoch) / (stride * vsync));
    if (slot === slotLast) return; slotLast = slot;
    if (PATH === 'E') {
      const c0 = performance.now();
      try { if (!E) setupE(); if (!kickE(Math.round(slot * stride * vsync * 1000), Math.round(stride * vsync * 1000))) drops++; } catch (e) { eErr = eErr || String(e && (e.name + ': ' + e.message)); }
      capCost.push(performance.now() - c0);
      return;
    }
    if (inFlight >= 2) { drops++; return; }
    if (PATH === 'F') {
      const c0 = performance.now(); const ts = Math.round(slot * stride * vsync * 1000), dur = Math.round(stride * vsync * 1000);
      try { inFlight++; createImageBitmap(canvas).then((bmp) => { worker.postMessage({ t: 'bitmap', bmp, ts, dur }, [bmp]); captured++; }).catch((e) => { inFlight--; capErr = capErr || String(e); }); } catch (e) { inFlight--; capErr = String(e); }
      capCost.push(performance.now() - c0);
      return;
    }
    if (PATH === 'S') {
      const c0 = performance.now();
      try {
        if (!window.__small) { const sw = 640, sh = Math.max(2, Math.round(640 * canvas.height / canvas.width / 2) * 2); window.__small = new OffscreenCanvas(sw, sh); window.__sctx = window.__small.getContext('2d', { alpha: false }); }
        window.__sctx.drawImage(canvas, 0, 0, window.__small.width, window.__small.height);
        const vf = new VideoFrame(window.__small, { timestamp: Math.round(slot * stride * vsync * 1000), duration: Math.round(stride * vsync * 1000), alpha: 'discard' });
        worker.postMessage({ t: 'frame', vf }, [vf]); inFlight++; captured++;
      } catch (e) { capErr = String(e && (e.name + ': ' + e.message)); }
      capCost.push(performance.now() - c0);
      return;
    }
    const c0 = performance.now();
    try {
      const vf = new VideoFrame(canvas, { timestamp: Math.round(slot * stride * vsync * 1000), duration: Math.round(stride * vsync * 1000), alpha: 'discard' });
      worker.postMessage({ t: 'frame', vf }, [vf]); inFlight++; captured++;
    } catch (e) { capErr = String(e && (e.name + ': ' + e.message)); }
    capCost.push(performance.now() - c0);
  }
  async function finish() {
    S.status = 'finishing';
    win.requestAnimationFrame = nativeRAF; win.cancelAnimationFrame = nativeCAF;
    // Re-queue any callbacks the game registered since the last dispatch so its loop keeps running.
    for (const [id, cb] of queue) if (!cancelled.has(id)) nativeRAF(cb);
    const fpsOf = (a) => (a.length ? 1000 / (a.reduce((x, y) => x + y, 0) / a.length) : 0);
    const st = await new Promise((res) => { worker.onmessage = (e) => { if (e.data.t === 'stats') res(e.data.stats); }; worker.postMessage({ t: 'finish' }); });
    worker.terminate();
    S.result = {
      page: location.pathname, canvas: `${canvas.width}x${canvas.height}`, ctx: glType, path: PATH, lat: LAT, fps: FPS,
      baseFps: r2(fpsOf(intervals.base)), capFps: r2(fpsOf(intervals.cap)), postFps: r2(fpsOf(intervals.post)), postLongPct: r2(100 * intervals.post.filter((d) => d > 1.5 * vsync).length / Math.max(1, intervals.post.length)),
      baseP95: r2(pct(intervals.base, 0.95)), capP95: r2(pct(intervals.cap, 0.95)),
      longFramesBasePct: r2(100 * intervals.base.filter((d) => d > 1.5 * vsync).length / Math.max(1, intervals.base.length)),
      longFramesCapPct: r2(100 * intervals.cap.filter((d) => d > 1.5 * vsync).length / Math.max(1, intervals.cap.length)),
      capCostP50: r2(pct(capCost, 0.5)), capCostP95: r2(pct(capCost, 0.95)), captured, drops, capErr, dispatches, enc: st, eErr, eReady, eNotReady, ePendingMax, ePollP50: r2(pct(ePollCost, 0.5)), ePollP95: r2(pct(ePollCost, 0.95)), eSize: E ? E.CW + 'x' + E.CH : null,
    };
    S.result.fpsLossPct = S.result.baseFps ? r2(100 * (1 - S.result.capFps / S.result.baseFps)) : null;
    log(JSON.stringify(S.result));
    S.status = 'done';
  }
  new Promise((res) => { worker.onmessage = (e) => { if (e.data.t === 'ready' || e.data.t === 'cfgerr') res(e.data); }; worker.postMessage({ t: 'config', mode: (PATH === 'D' || PATH === 'E' || PATH === 'F' || PATH === 'S' || PATH === 'P') ? 'D' : 'direct', cfg: { codec: 'avc1.64001f', width: W, height: H, bitrate: 2500000, bitrateMode: 'variable', framerate: FPS, latencyMode: LAT, avc: { format: 'avc' } } }); })
    .then((m) => { worker.onmessage = (e) => { if (e.data.t === 'consumed') inFlight--; }; log('encoder ' + m.t + (m.err ? ' ' + m.err : '')); });
  return 'started ' + canvas.width + 'x' + canvas.height + ' ' + glType;
})()
