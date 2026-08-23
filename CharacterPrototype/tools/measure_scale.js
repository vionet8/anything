// Scale, measured the way a set dresser measures it: stand her shoulder to
// shoulder with the thing, shoot it on a long lens from side on so perspective
// stops lying, and rule the frame in metres.
const { chromium } = require('@playwright/test');
const OUT = '/tmp/claude-0/-home-user-anything/4b640c7c-0c47-565d-8a67-b3261436d439/scratchpad';

const SHOTS = [
  ['bench', 'park', 'bench'],
  ['tree', 'park', 'tree'],
  ['broadleaf', 'park', 'broadleaf'],
  ['lamp', 'park', 'park lamp'],
  ['shrub', 'park', 'shrub'],
  ['palm', 'beach', 'palm'],
  ['jetty', 'beach', 'jetty'],
  ['machine', 'street', 'vending machine'],
  ['streetlamp', 'street', 'street lamp'],
  ['streettree', 'street', 'broadleaf'],
  ['pole', 'street', 'power lines'],
  ['shopfront', 'street', 'building'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 760, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 40000 });
  await page.evaluate(() => {
    document.getElementById('ui').style.display = 'none';
    const pg = document.querySelector('.pg-root'); if (pg) pg.style.display = 'none';
  });
  await page.evaluate(() => window.__game.setCharacterForTest('b'));
  const her = await page.evaluate(() => window.__char.characterSizeForTest());
  console.log('her height', her.height.toFixed(3));

  for (const [name, scene, prop] of SHOTS) {
    await page.evaluate((k) => window.__char.setSceneForTest(k, 'noon'), scene);
    const spot = await page.evaluate((n) => window.__char.isolatePropForTest(n), prop);
    if (!spot) { console.log(name, 'NOT FOUND'); continue; }

    // Perpendicular to the line out from the origin, so she stands beside the
    // prop rather than behind it, and the camera looks along that same line.
    let len = Math.hypot(spot.x, spot.z);
    if (len < 0.5) { spot.x = 1; spot.z = 0; len = 1; }
    const ux = spot.x / len, uz = spot.z / len;      // outward
    const sx = -uz, sz = ux;                          // sideways
    const gap = 2.0;
    const px = spot.x + sx * gap, pz = spot.z + sz * gap;
    await page.evaluate(([x, z]) => window.__char.placeForTest(x, z), [px, pz]);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__char.setPausedForTest(true));

    // Long lens from far enough back that the two subjects sit at the same
    // depth to within a few per cent, framed on the first six metres.
    const D = 12, FOV = 32, CY = 2.6;   // 12m is OrbitControls' maxDistance
    const midx = (spot.x + px) / 2, midz = (spot.z + pz) / 2;
    await page.evaluate(([mx, mz, ux2, uz2, d, fov, cy]) => window.__char.setCameraForTest(
      { x: mx - ux2 * d, y: cy, z: mz - uz2 * d }, { x: mx, y: cy, z: mz }, fov),
    [midx, midz, ux, uz, D, FOV, CY]);
    await page.waitForTimeout(200);

    // Rule the frame in metres at the subjects' depth.
    await page.evaluate(([mx, mz]) => {
      document.querySelectorAll('.ruler').forEach((n) => n.remove());
      for (let m = 0; m <= 14; m += 1) {
        const p = window.__char.projectForTest({ x: mx, y: m, z: mz });
        if (p.y < -20 || p.y > window.innerHeight + 20) continue;
        const line = document.createElement('div');
        line.className = 'ruler';
        line.style.cssText = `position:fixed;left:0;right:0;top:${p.y}px;height:1px;`
          + `background:${m % 5 === 0 ? 'rgba(255,60,60,.9)' : 'rgba(0,0,0,.35)'};z-index:99`;
        const tag = document.createElement('div');
        tag.className = 'ruler';
        tag.textContent = `${m}m`;
        tag.style.cssText = `position:fixed;left:4px;top:${p.y - 13}px;color:#d00;`
          + 'font:11px monospace;z-index:99;text-shadow:0 0 3px #fff';
        document.body.append(line, tag);
      }
    }, [midx, midz]);
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${OUT}/sc-${name}.png` });
    await page.evaluate(() => document.querySelectorAll('.ruler').forEach((n) => n.remove()));
    await page.evaluate(() => window.__char.isolatePropForTest(null));
    await page.evaluate(() => window.__char.setPausedForTest(false));
    console.log('shot', name, 'at', spot.x.toFixed(1), spot.z.toFixed(1));
  }
  await browser.close();
})();
