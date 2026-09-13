// Screenshot a single model (VRM or GLB) through preview.html at three fixed
// framings, so any two files can be judged under identical lighting/camera.
//
// Usage: node tools/shoot_preview.js <assets/relative/path.vrm> <out-prefix>
//   -> writes <out-prefix>-full.png, <out-prefix>-bust.png, <out-prefix>-face.png
//
// Requires the static server already running (node server.js) on :4300.
const { chromium } = require('@playwright/test');

const [, , modelPath, outPrefix] = process.argv;
if (!modelPath || !outPrefix) {
  console.error('usage: node tools/shoot_preview.js <model path under CharacterPrototype/> <out-prefix>');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

  const url = `http://localhost:4300/preview.html?model=${encodeURIComponent(modelPath)}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__preview && window.__preview.ready !== false, null, { timeout: 40000 });

  const state = await page.evaluate(() => window.__preview.ready);
  if (state === 'error') {
    console.error('model failed to load, see PAGE ERROR / CONSOLE ERROR above');
    await browser.close();
    process.exit(1);
  }

  for (const shot of ['full', 'bust', 'face']) {
    await page.evaluate((k) => { window.__preview.setShotForTest(k); window.__preview.render(); }, shot);
    await page.waitForTimeout(150);
    const out = `${outPrefix}-${shot}.png`;
    await page.screenshot({ path: out });
    console.log('wrote', out);
  }

  await browser.close();
})();
