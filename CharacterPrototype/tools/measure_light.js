#!/usr/bin/env node
/**
 * Print how bright her face comes out, at a range of light angles and exposure
 * compensations.
 *
 * The photo game judges a shot partly on whether her face is properly exposed,
 * and the band that counts as "properly" has to come from the renderer rather
 * than from an opinion: the auto exposure meters the real frame, so what a
 * backlit face actually reads is an emergent number, not a setting. This prints it.
 *
 * Light angle is measured the way the photographer experiences it: 0 means the
 * sun is behind the camera and full on her face, 180 means shooting into it.
 *
 * Usage:  node tools/measure_light.js
 *         Requires the dev server on :4300.
 */

const { chromium } = require('@playwright/test');

const ANGLES = [0, 45, 90, 135, 180];
const COMPENSATIONS = [0, 1, 2];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Camera in front of her at portrait distance, and left there: only the sun
  // moves, so every row differs by the light alone.
  await page.evaluate(() => {
    const head = window.__char.getBoneWorld('head');
    window.__char.setCameraForTest(
      { x: head.x, y: head.y, z: head.z - 2.2 }, { x: head.x, y: head.y, z: head.z }
    );
  });

  console.log('angle  EV   metered  auto   faceLuma');
  for (const angle of ANGLES) {
    // The camera sits on -Z looking at +Z, so the sun's azimuth for a given
    // light angle is measured round from there.
    await page.evaluate((degrees) => {
      window.__game.setSunForTest(Math.PI - degrees * Math.PI / 180, 0.30);
    }, angle);
    await page.waitForTimeout(3000);   // let the auto exposure settle fully

    for (const stops of COMPENSATIONS) {
      await page.evaluate((ev) => window.__game.setCompensationForTest(ev), stops);
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__game.startForTest(
        { pose: 'idle', expression: 'happy', framing: 'medium' }
      ));
      const shot = await page.evaluate(() => window.__game.shootForTest());
      const exposure = await page.evaluate(() => window.__game.getExposureForTest());
      const real = await page.evaluate(() => window.__game.lightAngleForTest());
      const sun = await page.evaluate(() => window.__char.getSunForTest());
      console.log(
        `${real.toFixed(0).padStart(4)}  ${stops >= 0 ? '+' : ''}${stops}   ` +
        `${exposure.metered.toFixed(3)}    ${exposure.auto.toFixed(2)}   ` +
        `${shot.faceLuma === null ? '  n/a' : shot.faceLuma.toFixed(3)}` +
        `   sun=(${sun.x.toFixed(0)},${sun.z.toFixed(0)})`
      );
    }
    await page.evaluate(() => window.__game.setCompensationForTest(0));
    await page.waitForTimeout(2500);
  }

  await browser.close();
})();
