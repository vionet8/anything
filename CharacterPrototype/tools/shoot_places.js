// The three places as the game actually opens them: default camera, no
// intervention. This is the frame the scale complaint is about.
const { chromium } = require('@playwright/test');
const OUT = '/tmp/claude-0/-home-user-anything/4b640c7c-0c47-565d-8a67-b3261436d439/scratchpad';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 40000 });
  await page.evaluate(() => {
    document.getElementById('ui').style.display = 'none';
    const pg = document.querySelector('.pg-root'); if (pg) pg.style.display = 'none';
  });
  await page.evaluate(() => window.__game.setCharacterForTest('b'));
  for (const scene of ['park', 'beach', 'street']) {
    for (const time of ['morning', 'noon', 'golden', 'night']) {
      await page.evaluate(([k, t]) => window.__char.setSceneForTest(k, t), [scene, time]);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/dc-${scene}-${time}.png` });
    }
  }
  await browser.close();
})();
