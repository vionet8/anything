const { chromium } = require('@playwright/test');
const OUT = '/tmp/claude-0/-home-user-anything/4b640c7c-0c47-565d-8a67-b3261436d439/scratchpad';
// Three consecutive quiet samples. One is worth about 0.03 of face luma,
// which is most of the effect being measured -- the whole reason the earlier
// readings of this disagreed with each other.
async function settle(page) {
  let previous = null;
  let quiet = 0;
  for (let i = 0; i < 120; i++) {
    const auto = (await page.evaluate(() => window.__game.getExposureForTest())).auto;
    if (previous !== null && Math.abs(auto - previous) < 0.003) {
      if (++quiet >= 3) return;
    } else { quiet = 0; }
    previous = auto;
    await page.waitForTimeout(200);
  }
}
async function shoot(page, degrees, stops) {
  await page.evaluate(([angle, ev]) => {
    const head = window.__char.getBoneWorld('head');
    window.__char.setCameraForTest(
      { x: head.x, y: head.y, z: head.z - 2.2 }, { x: head.x, y: head.y, z: head.z });
    window.__game.setSunForTest(Math.PI - angle * Math.PI / 180, 0.3);
    window.__game.setCompensationForTest(ev);
  }, [degrees, stops]);
  await settle(page);
  const shots = [];
  for (let i = 0; i < 3; i++) {
    shots.push(await page.evaluate(() => window.__game.shootForTest()));
    await page.waitForTimeout(120);
  }
  shots.sort((a, b) => a.faceLuma - b.faceLuma);
  return shots[1];
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 40000 });
  await page.evaluate(() => window.__game.startForTest({ pose: 'idle', expression: 'happy', framing: 'medium' }));
  await page.evaluate(() => window.__char.setSceneForTest('street', 'noon'));
  for (const darken of [0.62, 0.4, 0.25, 0.1]) {
    for (const who of ['a', 'b', 'c']) {
      await page.evaluate((k) => window.__game.setCharacterForTest(k), who);
      await page.waitForFunction(() => window.__char.ready, null, { timeout: 40000 });
      const n = await page.evaluate((d) => window.__char.setShadeForTest(d), darken);
      const f = await shoot(page, 0, 0);
      const b = await shoot(page, 180, 0);
      const l = await shoot(page, 180, 1 / 3);
      console.log(`darken ${darken}  ${who}  front ${f.faceLuma.toFixed(3)}  back ${b.faceLuma.toFixed(3)}  +1/3 ${l.faceLuma.toFixed(3)}   (${n} mats)`);
      if (who === 'b') {
        await page.evaluate(() => { document.getElementById('ui').style.display='none'; const g=document.querySelector('.pg-root'); if(g) g.style.display='none'; });
        await shoot(page, 55, 0);
        await page.screenshot({ path: `${OUT}/shade-${darken}.png` });
      }
    }
  }
  await browser.close();
})();
