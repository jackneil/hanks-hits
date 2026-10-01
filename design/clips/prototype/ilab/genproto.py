import json
m=open('/tmp/hh-clips/proto/main.js').read(); w=open('/tmp/hh-clips/proto/worker.js').read()
for a,b in [('new Worker(new URLSearchParams(location.search).get("poly") ? "worker-poly.js" : "worker.js")','new Worker(__wurl)'),
            ('await fetch("/upload?name=" + encodeURIComponent(name), { method: "POST", body: data });','window.__proto.files[name] = data;'),
            ('new URLSearchParams(location.search).get("tag") || "run"','"iphone-se3"'),
            ('document.title = "DONE";','document.title = "DONE"; window.__proto.status = "done";'),
            ('document.title = "FATAL";','document.title = "FATAL"; window.__proto.status = "fatal";')]:
    assert a in m, a; m=m.replace(a,b)
head = """(() => {
  window.__proto = { status: 'running', files: {} };
  const old = document.getElementById('hh-lab'); if (old) old.remove();
  const root = document.createElement('div'); root.id = 'hh-lab';
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;color:#eee;overflow:auto';
  root.innerHTML = '<pre id="out" style="white-space:pre-wrap;margin:0;padding:8px;font:11px ui-monospace,Menlo,monospace"></pre>';
  document.body.appendChild(root);
  const __wurl = URL.createObjectURL(new Blob([__WSRC__], { type: 'text/javascript' }));
""".replace('__WSRC__', json.dumps(w))
open('proto-inject.js','w').write(head + m + "\n  return 'started';\n})()")
