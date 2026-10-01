// Encode worker for the capture-path lab. Receives VideoFrames, optionally
// composites them into a fixed 720x1280 OffscreenCanvas (path D), and encodes.
let enc = null, cfg = null, comp = null, cctx = null, stats = null, mode = 'direct', frameNo = 0, lastKey = -1e9;
function reset() { stats = { outOfOrder: 0, lastOutTs: -1, deltaTypes: {}, submitted: 0, outputs: 0, keys: 0, errors: [], dropsQueue: 0, firstEncodeAt: 0, firstOutputAt: 0, bytes: 0, encodeMs: [], sizes: new Set() }; }
reset();
function mk(c) {
  enc = new VideoEncoder({
    output: (chunk) => { if (chunk.timestamp < stats.lastOutTs) stats.outOfOrder++; stats.lastOutTs = chunk.timestamp; stats.deltaTypes[chunk.type] = (stats.deltaTypes[chunk.type] || 0) + 1; if (!stats.firstOutputAt) stats.firstOutputAt = performance.now(); stats.outputs++; stats.bytes += chunk.byteLength; if (chunk.type === 'key') stats.keys++; },
    error: (e) => { stats.errors.push(String(e && (e.name + ': ' + e.message))); },
  });
  enc.configure(c);
}
onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'config') {
    cfg = m.cfg; mode = m.mode; frameNo = 0; lastKey = -1e9; reset();
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (!s.supported) { postMessage({ t: 'cfgerr', err: 'unsupported' }); return; } } catch (err) { postMessage({ t: 'cfgerr', err: String(err) }); return; }
    try { if (enc && enc.state !== 'closed') enc.close(); } catch {}
    mk(cfg);
    if (mode === 'D') { comp = new OffscreenCanvas(cfg.width, cfg.height); cctx = comp.getContext('2d', { alpha: false }); }
    postMessage({ t: 'ready' });
  } else if (m.t === 'frame' || m.t === 'bitmap') {
    let vf = m.vf; const t0 = performance.now();
    if (m.t === 'bitmap') { try { vf = new VideoFrame(m.bmp, { timestamp: m.ts, duration: m.dur }); } catch (err) { stats.errors.push('bitmap ' + err); postMessage({ t: 'consumed' }); return; } m.bmp.close(); }
    try {
      stats.sizes.add(vf.displayWidth + 'x' + vf.displayHeight);
      if (!enc || enc.state !== 'configured' || enc.encodeQueueSize >= 2) { stats.dropsQueue++; vf.close(); postMessage({ t: 'consumed' }); return; }
      let frame = vf;
      if (mode === 'D') {
        const W = cfg.width, H = cfg.height;
        const s = Math.min(W / vf.displayWidth, (H - 120) / vf.displayHeight);
        const w = vf.displayWidth * s, h = vf.displayHeight * s;
        cctx.fillStyle = '#0f172a'; cctx.fillRect(0, 0, W, H);
        cctx.drawImage(vf, (W - w) / 2, 120, w, h);
        cctx.fillStyle = '#fff'; cctx.font = 'bold 44px system-ui'; cctx.fillText('Monster Truck  12,400', 32, 76);
        frame = new VideoFrame(comp, { timestamp: vf.timestamp, duration: vf.duration || 33333 });
        vf.close();
      }
      const key = frame.timestamp - lastKey >= 1_000_000;
      if (key) lastKey = frame.timestamp;
      if (!stats.firstEncodeAt) stats.firstEncodeAt = performance.now();
      enc.encode(frame, { keyFrame: key }); stats.submitted++;
      frame.close();
    } catch (err) { stats.errors.push(String(err && (err.name + ': ' + err.message))); try { vf.close(); } catch {} }
    stats.encodeMs.push(performance.now() - t0);
    postMessage({ t: 'consumed' });
  } else if (m.t === 'finish') {
    try { if (enc && enc.state === 'configured') await enc.flush(); } catch (err) { stats.errors.push('flush ' + err); }
    const s = { ...stats, sizes: [...stats.sizes], ttfcMs: stats.firstOutputAt && stats.firstEncodeAt ? stats.firstOutputAt - stats.firstEncodeAt : null };
    const em = stats.encodeMs.slice().sort((a, b) => a - b); s.workerMsP50 = em[Math.floor(em.length * 0.5)] || 0; s.workerMsP95 = em[Math.floor(em.length * 0.95)] || 0; delete s.encodeMs;
    try { enc.close(); } catch {}
    postMessage({ t: 'stats', stats: s });
  }
};
