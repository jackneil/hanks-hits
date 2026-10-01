onmessage = async () => {
  const res = {};
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('hh-view-test.bin', { create: true });
    const h = await fh.createSyncAccessHandle();
    h.truncate(0);
    const backing = new Uint8Array(65536); backing.fill(7); backing[100] = 0xAA; backing[101] = 0xBB;
    const view = backing.subarray(100, 108);
    const n1 = h.write(view, { at: 0 });
    const n2 = h.write(new Uint8Array([1, 2, 3, 4]), { at: 8 });
    h.flush();
    res.size = h.getSize(); res.n1 = n1; res.n2 = n2;
    const rb = new Uint8Array(res.size); h.read(rb, { at: 0 });
    res.first12 = Array.from(rb.subarray(0, 12));
    // truncate test for crash-recovery
    h.truncate(10); res.afterTruncate = h.getSize();
    h.close();
    await root.removeEntry('hh-view-test.bin');
    const est = await navigator.storage.estimate(); res.quotaGB = +(est.quota / 1e9).toFixed(1); res.usage = est.usage;
    res.persisted = navigator.storage.persisted ? 'n/a-in-worker' : 'none';
  } catch (e) { res.error = String(e); }
  postMessage(res);
};
