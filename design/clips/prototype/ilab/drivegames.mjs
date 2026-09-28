import fs from 'node:fs';
const [,, sid, ...games] = process.argv;
const base = `http://127.0.0.1:4444/session/${sid}`;
const call = async (p, body, method) => { const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const ex = (script) => call('/execute/sync', { script, args: [] });
await call('/timeouts', { script: 30000, pageLoad: 60000, implicit: 0 });
const inject = fs.readFileSync('/tmp/hh-clips/ilab/game-inject.js', 'utf8').trim();
const all = [];
for (const g of games) {
  const [id, params = ''] = g.split('?');
  try {
    await call('/url', { url: `https://hankshits.com/games/${id}` });
    await new Promise((r) => setTimeout(r, 3500));
    if (process.env.JS_CLICK === '1') {
      let big = 0;
      for (let k = 0; k < 5 && big < 200000; k++) {
        await ex(`const b = [...document.querySelectorAll('button')].filter(x => /Play|Start/.test(x.textContent) && x.offsetParent).pop(); if (b) b.click(); return !!b`);
        await new Promise((r) => setTimeout(r, 3000));
        big = await ex(`let m = 0; const f = (d) => { for (const c of d.querySelectorAll('canvas')) { m = Math.max(m, c.width * c.height); } }; f(document); for (const i of document.querySelectorAll('iframe')) { try { f(i.contentDocument); } catch {} } return m`);
        console.log(id, 'js click', k, 'biggest canvas', big);
      }
      await new Promise((r) => setTimeout(r, 2500));
    } else if (process.env.HUMAN_TAP === '1') {
      console.log(id, '>>> waiting for a human Play tap');
      const t1 = Date.now(); let big = 0;
      while (Date.now() - t1 < 90000) {
        await new Promise((r) => setTimeout(r, 1500));
        big = await ex(`let m = 0; const f = (d) => { for (const c of d.querySelectorAll('canvas')) { const a = c.width * c.height; if (a > m) m = a; } }; f(document); for (const i of document.querySelectorAll('iframe')) { try { f(i.contentDocument); } catch {} } return m`);
        const cardUp = await ex(`return !!document.querySelector('[data-start-overlay], [aria-label*="start" i]') || [...document.querySelectorAll('button')].some(b => /^\\W*(▶ )?Play!?$/.test(b.textContent.trim()) && b.offsetParent)`);
        if (big > 200000 && !cardUp) break;
      }
      console.log(id, 'game canvas area', big);
      await new Promise((r) => setTimeout(r, 2500));
    } else {
    // tap Play on the start card if present (real WebDriver click = trusted gesture)
    const els = await call('/elements', { using: 'xpath', value: "//button[contains(normalize-space(.), 'Play') or contains(normalize-space(.), 'Start')]" });
    if (els.length) {
      const eid = Object.values(els[0])[0];
      try { await call(`/element/${eid}/click`, {}); console.log(id, 'tapped', await call(`/element/${eid}/text`).catch(() => '?')); }
      catch (e) {
        const who = await ex(`const b=[...document.querySelectorAll('button')].find(x=>/Play|Start/.test(x.textContent)); if(!b) return 'none'; const r=b.getBoundingClientRect(); const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return {btn:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], vh: innerHeight, cover: el ? (el.tagName+'#'+el.id+'.'+String(el.className).slice(0,120)) : null, coverText: el ? el.textContent.slice(0,80) : null}`);
        console.log(id, 'click intercepted by', JSON.stringify(who));
        await ex(`const b=[...document.querySelectorAll('button')].find(x=>/Play|Start/.test(x.textContent)); b.scrollIntoView({block:'center'}); return 1`);
        await new Promise((r) => setTimeout(r, 800));
        try { await call(`/element/${eid}/click`, {}); console.log(id, 'tapped after scroll'); } catch (e2) { console.log(id, 'still intercepted; skipping game (no synthetic clicks)'); throw e2; }
      }
    }
    else console.log(id, 'no Play button found');
    // verify the start card is really gone; re-tap (trusted WebDriver click) up to 3 more times
    for (let k = 0; k < 4; k++) {
      await new Promise((r) => setTimeout(r, 2500));
      const still = await call('/elements', { using: 'xpath', value: "//button[contains(normalize-space(.), 'Play') or contains(normalize-space(.), 'Start')]" });
      if (!still.length) break;
      console.log(id, 'start card still up, re-tapping');
      try { await call(`/element/${Object.values(still[0])[0]}/click`, {}); } catch (e) { console.log(id, 're-tap failed', e.message.slice(0, 80)); }
    }
    }
    await ex('window.__labParams = ' + JSON.stringify(params) + '; return 1');
    console.log(id, 'inject:', await ex('return (' + inject + '\n)'));
    const t0 = Date.now(); let st;
    for (;;) { await new Promise((r) => setTimeout(r, 3000)); st = await ex('return window.__gcap && { s: window.__gcap.status, log: window.__gcap.log, r: window.__gcap.result }'); if (!st || st.s === 'done' || st.s === 'error' || Date.now() - t0 > 60000) break; }
    console.log(id, st ? st.log.trim() : 'no state');
    const snaps = await ex('return (window.__gcap && window.__gcap.snaps) || []');
    snaps.forEach((u, i) => { const f = `/tmp/hh-clips/ilab/out/snap-${id}-${i}.png`; fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); console.log(id, 'snapshot', f); });
    all.push({ id, params, ...(st && st.r ? st.r : { error: st ? st.log : 'no state' }) });
  } catch (e) { console.log(id, 'ERROR', e.message); all.push({ id, params, error: e.message }); }
}
const f = `/tmp/hh-clips/ilab/out/games-iphone-se3-${Date.now()}.json`; fs.writeFileSync(f, JSON.stringify(all, null, 1)); console.log('saved', f);
