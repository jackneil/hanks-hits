const tag = new URLSearchParams(location.search).get('tag') || 'opfs';
const w = new Worker('opfs-worker.js');
w.onmessage = async (e) => { const res = { ua: navigator.userAgent, worker: e.data, persisted: await navigator.storage.persisted?.() }; await fetch('/upload?name=' + tag + '-results.json', { method: 'POST', body: JSON.stringify(res, null, 1) }); document.getElementById('o').textContent = JSON.stringify(res) + '\nDONE'; document.title = 'DONE'; };
w.postMessage(1);
