#!/usr/bin/env node
/**
 * Measure how much the spring bones actually swing while she runs.
 *
 * Secondary motion can't be judged from a screenshot -- it only exists over
 * time -- so this samples a bust joint and a hair tip every frame during a run
 * and reports how far each travels relative to the body part it hangs off.
 * That turns "too bouncy" into a number that can be compared before and after.
 *
 * Usage:  node tools/measure_spring.js        (dev server must be on :4300)
 */

const { chromium } = require('@playwright/test');

const SAMPLES = [
  ['bust', 'J_Sec_L_Bust2', 'chest'],
  ['hair', 'HairJoint-9c6ca9d2-d5a3-46d7-ba00-a14a2460efdb', 'head'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 30000 });

  const settings = await page.evaluate(() => window.__char.getSpringSettings());
  const summary = {};
  for (const s of settings) {
    const group = s.bone.startsWith('HairJoint') ? 'hair'
      : /Bust/.test(s.bone) ? 'bust'
      : /Skirt|Coat/.test(s.bone) ? 'skirt/jacket' : 'other';
    summary[group] = `drag=${s.dragForce.toFixed(2)} stiffness=${s.stiffness.toFixed(2)}`;
  }
  console.log('spring settings in use:');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(13)} ${v}`);

  const tracks = await page.evaluate((pairs) => {
    const out = {};
    for (const [label] of pairs) out[label] = [];
    // Run on the spot for two seconds of simulated time, sampling every frame.
    for (let i = 0; i < 120; i++) {
      window.__char.moveForTest('forward', 16, true);
      for (const [label, node, anchor] of pairs) {
        const p = window.__char.getSpringOffsetForTest(node, anchor);
        if (p) out[label].push([p.x, p.y, p.z]);
      }
    }
    return out;
  }, SAMPLES);

  console.log('\nswing while running (relative to its anchor bone, metres):');
  for (const [label, track] of Object.entries(tracks)) {
    if (!track.length) { console.log(`  ${label}: no samples`); continue; }
    const range = [0, 1, 2].map((axis) => {
      const values = track.map((p) => p[axis]);
      return Math.max(...values) - Math.min(...values);
    });
    const travel = Math.hypot(...range);
    console.log(`  ${label.padEnd(5)} peak-to-peak  x=${range[0].toFixed(4)} y=${range[1].toFixed(4)} z=${range[2].toFixed(4)}  total=${travel.toFixed(4)}`);
  }

  await browser.close();
})();
