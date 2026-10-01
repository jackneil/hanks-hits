(() => {
  const S = (window.__stor = { status: 'running', r: {} });
  const WSRC = `onmessage = async (e) => {
    const out = {};
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('hh-lab-test.bin', { create: true });
      const h = await fh.createSyncAccessHandle();
      const chunk = new Uint8Array(1 << 20); for (let i = 0; i < chunk.length; i++) chunk[i] = i & 255;
      const t0 = performance.now(); let pos = 0;
      for (let i = 0; i < 40; i++) { h.write(chunk, { at: pos }); pos += chunk.length; }
      const t1 = performance.now(); h.flush(); const t2 = performance.now();
      out.writeMBps = Math.round(40 / ((t1 - t0) / 1000)); out.flushMs = Math.round(t2 - t1); out.size = h.getSize();
      const rb = new Uint8Array(1 << 20); const t3 = performance.now(); for (let i = 0; i < 40; i++) h.read(rb, { at: i << 20 }); out.readMBps = Math.round(40 / ((performance.now() - t3) / 1000));
      out.readOk = rb[123] === 123;
      h.close(); await root.removeEntry('hh-lab-test.bin'); out.cleaned = true;
    } catch (err) { out.err = String(err && (err.name + ': ' + err.message)); }
    postMessage(out);
  };`;
  (async () => {
    const r = S.r;
    try { const e = await navigator.storage.estimate(); r.quotaGB = +(e.quota / 1e9).toFixed(2); r.usageMB = +(e.usage / 1e6).toFixed(1); } catch (e) { r.estimateErr = String(e); }
    try { r.persistedBefore = await navigator.storage.persisted(); } catch (e) { r.persistedErr = String(e); }
    try { r.persistResult = await navigator.storage.persist(); } catch (e) { r.persistErr = String(e); }
    r.standalone = matchMedia('(display-mode: standalone)').matches;
    r.canShareFilesMp4 = !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(8)], 'a.mp4', { type: 'video/mp4' })] }));
    r.webglCaptureFlag = typeof HTMLCanvasElement.prototype.captureStream;
    const w = new Worker(URL.createObjectURL(new Blob([WSRC], { type: 'text/javascript' })));
    r.opfsWorker = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage(1); setTimeout(() => res({ err: 'timeout' }), 20000); });
    w.terminate(); S.status = 'done';
  })().catch((e) => { S.r.fatal = String(e); S.status = 'done'; });
  return 'started';
})()
