// Runs the encoder and OPFS checks inside a dedicated worker.
self.onmessage = async (e) => {
  const { w, h, frames, codec } = e.data;
  const out = { typeofVideoEncoder: typeof VideoEncoder, typeofOffscreenCanvas: typeof OffscreenCanvas, typeofAudioEncoder: typeof AudioEncoder };
  try {
    const cv = new OffscreenCanvas(w, h); const g = cv.getContext('2d');
    let chunks = 0, keys = 0, bytes = 0, desc = null;
    const enc = new VideoEncoder({ output: (c, m) => { chunks++; bytes += c.byteLength; if (c.type === 'key') keys++; if (m && m.decoderConfig && m.decoderConfig.description) desc = m.decoderConfig.description.byteLength; }, error: (er) => { out.encError = String(er); } });
    enc.configure({ codec, width: w, height: h, bitrate: 3_000_000, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' } });
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      g.fillStyle = `hsl(${(i * 7) % 360} 70% 50%)`; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = `${Math.round(h / 6)}px sans-serif`; g.fillText(String(i), w / 3, h / 2);
      const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / 30), duration: Math.round(1e6 / 30) });
      enc.encode(vf, { keyFrame: i % 30 === 0 }); vf.close();
      if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
    }
    await enc.flush(); enc.close();
    out.encode = { codec, w, h, frames, chunks, keys, bytes, descBytes: desc, wallMs: Math.round(performance.now() - t0), fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1) };
  } catch (er) { out.encodeError = String(er && er.message || er); }
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('hh-probe-worker.bin', { create: true });
    const ah = await fh.createSyncAccessHandle();
    const buf = new Uint8Array(4 * 1024 * 1024); for (let i = 0; i < buf.length; i += 4096) buf[i] = i & 255;
    const t0 = performance.now();
    ah.truncate(0); ah.write(buf, { at: 0 }); ah.flush();
    const size = ah.getSize(); const rb = new Uint8Array(4096); ah.read(rb, { at: 4096 });
    ah.close(); await root.removeEntry('hh-probe-worker.bin');
    out.opfsSync = { ok: size === buf.length && rb[0] === (4096 & 255), size, ms: Math.round(performance.now() - t0) };
  } catch (er) { out.opfsSyncError = String(er && er.message || er); }
  self.postMessage(out);
};
