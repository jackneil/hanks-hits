// Runs the probe page in every locally available Playwright browser.
import { chromium, webkit, firefox } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 47811;
const srv = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise(r => setTimeout(r, 800));
const targets = (process.argv[2] || 'chromium-headless,chromium-headed,chrome-headed,chrome-headless').split(',');
const summary = {};
for (const t of targets) {
  const [engine, mode] = t.split('-');
  const bt = engine === 'webkit' ? webkit : engine === 'firefox' ? firefox : chromium;
  const opts = { headless: mode !== 'headed' };
  if (engine === 'chrome') opts.channel = 'chrome';
  if (engine === 'msedge') opts.channel = 'msedge';
  let browser;
  try {
    browser = await bt.launch(opts);
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log(`[${t}] console.error`, m.text().slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/?label=${t}`);
    await page.waitForFunction(() => window.__probe, null, { timeout: 240000 });
    summary[t] = { version: browser.version(), ok: true };
  } catch (e) { summary[t] = { error: String(e.message || e).slice(0, 400) }; }
  finally { if (browser) await browser.close(); }
}
console.log(JSON.stringify(summary, null, 1));
srv.kill();
