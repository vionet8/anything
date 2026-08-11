#!/usr/bin/env node
/**
 * Print where a pose actually puts the hands, relative to the head.
 *
 * Poses in this project are hand-authored bone rotations, and rotation numbers
 * say almost nothing about where a limb ends up -- past sessions burned time on
 * poses that looked plausible in code and wrong on screen. This prints the
 * measurement instead: hand position in head-local terms, so "beside the face"
 * can be checked as a number.
 *
 * Usage:  node tools/measure_pose.js [pose ...]     (default: double-peace)
 *         Requires the dev server on :4300.
 */

const { chromium } = require('@playwright/test');

const POSES = process.argv.slice(2).length ? process.argv.slice(2) : ['double-peace'];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 30000 });

  for (const pose of POSES) {
    const measured = await page.evaluate((name) => {
      window.__char.holdActionForTest(name, 400);
      const bones = ['head', 'leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftUpperArm'];
      const out = {};
      for (const bone of bones) out[bone] = window.__char.getBoneWorld(bone);
      window.__char.releaseActionsForTest();
      return out;
    }, pose);

    const head = measured.head;
    console.log(`\n${pose}`);
    console.log(`  head at y=${head.y.toFixed(3)}`);
    for (const side of ['left', 'right']) {
      const hand = measured[`${side}Hand`];
      const elbow = measured[`${side}LowerArm`];
      const dx = hand.x - head.x;
      const dy = hand.y - head.y;
      const dz = hand.z - head.z;
      const distance = Math.hypot(dx, dy, dz);
      console.log(
        `  ${side.padEnd(5)} hand  dx=${dx.toFixed(3)} dy=${dy.toFixed(3)} dz=${dz.toFixed(3)}` +
        `  dist=${distance.toFixed(3)}  elbow y=${elbow.y.toFixed(3)}`
      );
    }
  }

  await browser.close();
})();
