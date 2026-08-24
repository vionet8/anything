// Where each garment's UV islands are, taken off the model rather than guessed
// from looking at the texture.
//
// Rasterises every triangle of a material slot into UV space, colour-coded by
// the bone that carries most of its weight, and saves the result. Painting a
// costume means knowing which patch of a 768-square is a torso and which is a
// shin, and the only place that is written down is the mesh.
//
// It also wears the atlas, which is the part that matters: the first run had v
// the wrong way up and painted the leg texture onto the arms. That is obvious
// on the model and invisible in the numbers.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const OUT = process.argv[2] || '.';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 640 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 40000 });

  for (const slot of ['Body_00_SKIN', 'Tops', 'Bottoms']) {
    const atlas = await page.evaluate((m) => window.__char.uvAtlasForTest(m), slot);
    if (!atlas) { console.log(slot, 'not found'); continue; }
    fs.writeFileSync(`${OUT}/uv-${slot.split('_')[0]}.png`,
      Buffer.from(atlas.url.split(',')[1], 'base64'));
    console.log(slot, 'saved');
    if (slot === 'Body_00_SKIN') console.log(' ', atlas.legend.join('  '));
  }

  // And on the model, front and back.
  await page.evaluate(() => {
    document.getElementById('ui').style.display = 'none';
    const g = document.querySelector('.pg-root'); if (g) g.style.display = 'none';
  });
  await page.evaluate(() => window.__char.setPausedForTest(true));
  await page.evaluate(async () => {
    const atlas = window.__char.uvAtlasForTest('Body_00_SKIN');
    await window.__char.wearTextureForTest('Body_00_SKIN', atlas.url);
  });
  for (const [tag, z] of [['facing', -2.4], ['behind', 2.4]]) {
    await page.evaluate((zz) => window.__char.setCameraForTest(
      { x: 0, y: 0.98, z: zz }, { x: 0, y: 0.88, z: 0 }, 40), z);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/uv-worn-${tag}.png` });
  }
  await browser.close();
})();
