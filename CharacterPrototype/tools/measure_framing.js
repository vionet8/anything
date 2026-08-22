#!/usr/bin/env node
/**
 * Print how much of the frame her head fills, at a range of camera distances
 * and viewport shapes.
 *
 * The photo game's briefs ask for a tight or a loose shot, and the bands that
 * decide which is which are in fractions of the frame's height. That number is
 * not guessable from the camera distance alone -- it depends on the field of
 * view and on the shape of the window, and a phone held upright is a very
 * different frame from a desktop one. So it gets measured.
 *
 * Usage:  node tools/measure_framing.js
 *         Requires the dev server on :4300.
 */

const { chromium } = require('@playwright/test');

// Both shapes, because the bands have to hold on a phone as well. Measured,
// they come out identical: three.js takes `fov` as the *vertical* angle, so a
// fraction of the frame's height does not move when the window narrows. (What
// does change is how much of the width she fills, which is not what the brief
// asks about.)
const VIEWPORTS = [
  { label: 'desktop 1280x800', width: 1280, height: 800 },
  { label: 'phone    390x844', width: 390, height: 844 },
];
const DISTANCES = [0.75, 1.0, 1.4, 1.9, 2.5, 3.2, 4.0, 5.0, 6.5, 8.0, 11.0];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    await page.goto('http://localhost:4300/');
    await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 30000 });
    await page.waitForTimeout(1200); // let her turn to face the camera

    console.log(`\n${viewport.label}`);
    for (const distance of DISTANCES) {
      const measured = await page.evaluate((d) => {
        const head = window.__char.getBoneWorld('head');
        window.__char.setCameraForTest(
          { x: head.x, y: head.y, z: head.z - d },
          { x: head.x, y: head.y, z: head.z }
        );
        return window.__char.getState() && window.__game.measureForTest();
      }, distance);
      console.log(
        `  ${distance.toFixed(1)}m  faceSize=${measured.faceSize.toFixed(4)}` +
        `  (head fills ${(measured.faceSize * 100).toFixed(1)}% of the frame height)`
      );
    }
    await page.close();
  }

  await browser.close();
})();
