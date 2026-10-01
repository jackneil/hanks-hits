import json
src=open('paths.js').read(); wsrc=open('enc-worker.js').read()
head = r"""
(() => {
  if (window.__lab && window.__lab.status === 'running') return 'already running';
  const old = document.getElementById('hh-lab'); if (old) old.remove();
  const root = document.createElement('div'); root.id = 'hh-lab';
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;color:#eee;display:flex;flex-direction:column';
  root.innerHTML = '<div id="stage" style="position:relative;width:100vw;height:62vh;background:#000"></div><pre id="out" style="white-space:pre-wrap;margin:0;padding:8px;font:11px ui-monospace,Menlo,monospace;flex:1;overflow:auto"></pre>';
  document.body.appendChild(root);
  const st = document.createElement('style'); st.textContent = '#hh-lab #stage canvas{position:absolute;inset:0;width:100%;height:100%}'; root.appendChild(st);
  window.__lab = { status: 'running', log: '', results: null, error: null };
  const WORKER_SRC = __WSRC__;
  const workerURL = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
""".replace('__WSRC__', json.dumps(wsrc))
body = src
for a,b in [("const qs = new URLSearchParams(location.search);", "const qs = new URLSearchParams(window.__labParams || '');"),
 ("const log = (s) => { out.textContent += s + '\\n'; out.scrollTop = out.scrollHeight; };", "const log = (s) => { out.textContent += s + '\\n'; out.scrollTop = out.scrollHeight; window.__lab.log += s + '\\n'; };"),
 ("const worker = new Worker('enc-worker.js');", "const worker = new Worker(workerURL);"),
 ("document.getElementById('run').disabled = true;", ""), ("document.getElementById('run').disabled = false;", "")]:
    assert a in body, a; body = body.replace(a,b)
i = body.index("  try { await fetch('/r?name='"); j = body.index("\n", i)
body = body[:i] + "  window.__lab.results = results;" + body[j:]
k = body.index("document.getElementById('run').onclick")
body = body[:k] + "runAll().then(() => { window.__lab.status = 'done'; }).catch((e) => { window.__lab.status = 'error'; window.__lab.error = String(e && (e.stack || e)); log('FATAL ' + (e.stack || e)); });\n"
open('inject.js','w').write(head + body + "\n  return 'started';\n})()")
