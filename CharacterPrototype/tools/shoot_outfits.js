// Every outfit, front and back, so a costume can be judged rather than assumed.
const { chromium } = require('@playwright/test');
const OUT = '/tmp/claude-0/-home-user-anything/4b640c7c-0c47-565d-8a67-b3261436d439/scratchpad';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 380, height: 660 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 40000 });
  await page.evaluate(() => {
    document.getElementById('ui').style.display = 'none';
    const g = document.querySelector('.pg-root'); if (g) g.style.display = 'none';
  });
  // Pinned, because the cast loads in whatever order it finishes downloading
  // and comparing two runs of this against two different avatars is useless.
  await page.evaluate(() => window.__game.setCharacterForTest('a'));
  await page.waitForFunction(() => window.__char.ready);
  await page.evaluate(() => window.__char.setSceneForTest('park', 'noon'));
  await page.evaluate(() => window.__char.setPausedForTest(true));
  const outfits = await page.evaluate(() => window.__char.listOutfitsForTest());
  for (const o of outfits) {
    const got = await page.evaluate((k) => window.__char.setOutfitForTest(k), o.key);
    for (const [tag, z] of [['f', -2.3], ['b', 2.3]]) {
      await page.evaluate((zz) => window.__char.setCameraForTest(
        { x: 0, y: 0.98, z: zz }, { x: 0, y: 0.88, z: 0 }, 40), z);
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${OUT}/fit-${o.key}-${tag}.png` });
    }
    console.log(o.key, o.label, got === o.key ? 'ok' : `REFUSED (stayed ${got})`);
  }
  await browser.close();
})();
