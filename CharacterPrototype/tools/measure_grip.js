#!/usr/bin/env node
/**
 * Print where a held pose puts the thumb relative to the folded ring finger.
 *
 * The peace sign's fingers are the one part of this rig a screenshot cannot
 * settle: the palm is deep inside an oversized sleeve, so a finger that folds
 * sideways across the palm and a finger that folds down onto it look identical
 * from every camera that can see the hand at all. Both of those bugs shipped.
 *
 * So this measures instead, in a frame built from the hand itself:
 *
 *   up      along the fingers, wrist -> middle knuckle
 *   across  toward the little finger
 *   palm    out of the palm, the side the fingers fold toward
 *
 * All distances in centimetres from the wrist joint. What a correct peace sign
 * looks like here: the ring fingertip back down near the palm (palm ~1, up ~3,
 * against ~12 when it is straight), its middle joint standing clear of the
 * palm (~2.8), and the thumb tip on top of that joint -- same up and across,
 * about 0.8 further out in palm.
 *
 * Usage:  node tools/measure_grip.js [pose ...]   (default: peace double-peace)
 *         Requires the dev server on :4300.
 */

const { chromium } = require('@playwright/test');

const POSES = process.argv.slice(2).length ? process.argv.slice(2) : ['peace', 'double-peace'];
// Which hands each pose actually poses. Measuring the left hand in the single
// peace would report its idle pose as if it were a failed grip.
const HANDS = { peace: ['right'], 'double-peace': ['right', 'left'] };

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const norm = (a) => scale(a, 1 / Math.hypot(a.x, a.y, a.z));

// The hand's own frame. `palm` is a cross product, so which way it points is
// decided by the hand's handedness, not by the pose -- hence the flip on the
// left, without which every left-hand number would come back negated.
function handFrame(m, side) {
  const wrist = m[`${side}Hand`];
  const up = norm(sub(m[`${side}MiddleProximal`], wrist));
  const across = norm(sub(m[`${side}LittleProximal`], m[`${side}IndexProximal`]));
  const palm = scale(norm(cross(up, across)), side === 'left' ? -1 : 1);
  return (p) => ({
    up: dot(sub(p, wrist), up) * 100,
    across: dot(sub(p, wrist), across) * 100,
    palm: dot(sub(p, wrist), palm) * 100,
  });
}

const fmt = (p) => `up=${p.up.toFixed(2).padStart(6)} across=${p.across.toFixed(2).padStart(6)} palm=${p.palm.toFixed(2).padStart(6)}`;

const boneNames = (side) => [
  `${side}Hand`, `${side}IndexProximal`, `${side}MiddleProximal`, `${side}LittleProximal`,
  `${side}ThumbMetacarpal`, `${side}ThumbProximal`, `${side}ThumbDistal`,
  `${side}RingProximal`, `${side}RingIntermediate`, `${side}RingDistal`,
];
const tipNames = (side) => {
  const s = side === 'left' ? 'L' : 'R';
  return [`J_Bip_${s}_Thumb3_end`, `J_Bip_${s}_Ring3_end`, `J_Bip_${s}_Little3_end`];
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.goto('http://localhost:4300/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 30000 });

  for (const pose of POSES) {
    const sides = HANDS[pose] || ['right'];
    const measured = await page.evaluate(([name, bones, tips]) => {
      window.__char.holdActionForTest(name, 400);
      const out = {};
      for (const bone of bones) out[bone] = window.__char.getBoneWorld(bone);
      for (const tip of tips) out[tip] = window.__char.getNodeWorld(tip);
      window.__char.releaseActionsForTest();
      return out;
    }, [pose, sides.flatMap(boneNames), sides.flatMap(tipNames)]);

    console.log(`\n${pose}`);
    for (const side of sides) {
      const local = handFrame(measured, side);
      const s = side === 'left' ? 'L' : 'R';
      const thumbTip = local(measured[`J_Bip_${s}_Thumb3_end`]);
      const ringMid = local(measured[`${side}RingIntermediate`]);
      const gap = {
        up: thumbTip.up - ringMid.up, across: thumbTip.across - ringMid.across, palm: thumbTip.palm - ringMid.palm,
      };
      console.log(`  ${side}`);
      console.log(`    ring   knuckle ${fmt(local(measured[`${side}RingProximal`]))}`);
      console.log(`    ring   middle  ${fmt(ringMid)}`);
      console.log(`    ring   tip     ${fmt(local(measured[`J_Bip_${s}_Ring3_end`]))}`);
      console.log(`    thumb  ip      ${fmt(local(measured[`${side}ThumbDistal`]))}`);
      console.log(`    thumb  tip     ${fmt(thumbTip)}`);
      console.log(`    thumb tip - ring middle joint: ${fmt(gap)}` +
        `  (sideways ${Math.hypot(gap.up, gap.across).toFixed(2)})`);
    }
  }

  await browser.close();
})();
