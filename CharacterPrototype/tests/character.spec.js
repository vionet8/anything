const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 15000 });
});

test('character loads with a rigged skeleton and starts in idle', async ({ page }) => {
  const state = await page.evaluate(() => window.__char.getState());
  expect(state.animName).toBe('idle');
  expect(state.position).toEqual({ x: 0, y: 0, z: 0 });
});

test('holding a real movement key switches to the walk animation and moves the character', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyW');

  expect(midState.animName).toBe('walk');
  expect(midState.position.z).toBeGreaterThan(0);
});

test('releasing movement keys returns the character to idle', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => window.__char.getState());
  expect(state.animName).toBe('idle');
});

test('moving forward for a fixed simulated duration advances position deterministically', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.moveForTest('forward', 1000, false));
  // MOVE_SPEED is 3.2 units/sec; allow some tolerance for discrete stepping.
  expect(result.position.z).toBeGreaterThan(2.8);
  expect(result.position.z).toBeLessThan(3.6);
  expect(result.animName).toBe('idle'); // resets after the simulated hold ends
});

test('running moves the character further than walking for the same duration', async ({ page }) => {
  const walked = await page.evaluate(() => window.__char.moveForTest('forward', 1000, false));

  // Reload for a clean position reset before comparing against a run.
  await page.goto('/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 15000 });
  const ran = await page.evaluate(() => window.__char.moveForTest('forward', 1000, true));

  expect(ran.position.z).toBeGreaterThan(walked.position.z);
});

test('turning left changes heading and the character rotates to face the new direction', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.moveForTest('left', 500, false));
  // heading = atan2(moveX, moveZ); moving purely left (moveX=-1, moveZ=0) => heading = -PI/2.
  // Precision is loose (1 decimal, ~0.05 rad) because moveForTest ends with a
  // 1ms settle step after releasing the movement key, and that step is enough
  // for the idle "face the camera" turn to nudge heading very slightly off
  // the exact movement-derived value — expected, not a bug.
  expect(result.heading).toBeCloseTo(-Math.PI / 2, 1);
  expect(result.position.x).toBeLessThan(0);
});

test('waving in place does not move the character and reports the wave state', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.triggerActionForTest('wave', 600));
  expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
  // The action resets to idle once the key is released, same as walk/run.
  expect(result.animName).toBe('idle');
});

test('crouching in place does not move the character', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.triggerActionForTest('crouch', 600));
  expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(result.animName).toBe('idle');
});

test('peace sign in place does not move the character and reports the peace state', async ({ page }) => {
  await page.keyboard.down('KeyV');
  await page.waitForTimeout(300);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyV');
  await page.waitForTimeout(300);
  const afterState = await page.evaluate(() => window.__char.getState());

  expect(midState.animName).toBe('peace');
  expect(midState.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(afterState.animName).toBe('idle'); // resets once the key is released
});

test('jumping rises and returns to the ground and idle, without net horizontal movement', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.jumpForTest(900));
  // JUMP_VELOCITY=4.2, JUMP_GRAVITY=18 -> analytic max height = 0.49; allow
  // tolerance for discrete 16ms stepping.
  expect(result.maxHeight).toBeGreaterThan(0.4);
  expect(result.maxHeight).toBeLessThan(0.55);
  expect(result.position.y).toBe(0); // back on the ground by 900ms (full cycle is ~0.65s)
  expect(result.position.x).toBe(0);
  expect(result.position.z).toBe(0);
  expect(result.animName).toBe('idle'); // recovered and settled back to idle
});

test('a running jump keeps moving horizontally while airborne', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(100);
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  // Sample near the apex (~233ms), not late in the arc. The airborne phase
  // ends at ~467ms, so a 400ms wait left only ~67ms of margin and this failed
  // roughly two runs in three on real-time frame jitter.
  await page.waitForTimeout(250);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyW');

  expect(midState.animName).toBe('jump'); // jump outranks walk's animName while airborne
  expect(midState.position.z).toBeGreaterThan(0); // but WASD still moved her forward
});

test('double peace sign in place does not move the character and reports its own state', async ({ page }) => {
  await page.keyboard.down('KeyB');
  await page.waitForTimeout(300);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyB');
  await page.waitForTimeout(300);
  const afterState = await page.evaluate(() => window.__char.getState());

  expect(midState.animName).toBe('double-peace');
  expect(midState.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(afterState.animName).toBe('idle');
});

test('the double peace puts both hands up beside the face, not out at the shoulders', async ({ page }) => {
  const measured = await page.evaluate(() => {
    window.__char.holdActionForTest('double-peace', 500);
    const out = {
      head: window.__char.getBoneWorld('head'),
      left: window.__char.getBoneWorld('leftHand'),
      right: window.__char.getBoneWorld('rightHand'),
    };
    window.__char.releaseActionsForTest();
    return out;
  });

  for (const side of ['left', 'right']) {
    const hand = measured[side];
    const distance = Math.hypot(
      hand.x - measured.head.x, hand.y - measured.head.y, hand.z - measured.head.z
    );
    // Beside the face: close to the head, and level with it rather than
    // hanging below at shoulder height like the one-handed peace does.
    expect(distance, `${side} hand distance from head`).toBeLessThan(0.32);
    expect(hand.y, `${side} hand height`).toBeGreaterThan(measured.head.y - 0.1);
  }
  // One hand either side of the face, not both crowded onto one side.
  // Measured as a spread plus a centred midpoint so the check does not depend
  // on which way she happens to be facing.
  const spread = Math.hypot(measured.left.x - measured.right.x, measured.left.z - measured.right.z);
  const midX = (measured.left.x + measured.right.x) / 2;
  const midZ = (measured.left.z + measured.right.z) / 2;
  expect(spread, 'distance between the hands').toBeGreaterThan(0.25);
  expect(Math.hypot(midX - measured.head.x, midZ - measured.head.z),
    'hands centred on the head').toBeLessThan(0.1);
});

test('the model exposes the facial expressions the poses depend on', async ({ page }) => {
  // The previous model had every morph target stripped by an optimisation
  // pass, so this list came back empty and no expression could ever apply.
  // Nothing on screen said so, which is why it is asserted here.
  const expressions = await page.evaluate(() => window.__char.getExpressions());
  expect(expressions).toEqual(expect.arrayContaining(['happy', 'relaxed', 'blink']));
});

test('the peace poses and the jump smile, and idle does not', async ({ page }) => {
  const idle = await page.evaluate(() => window.__char.getState().smile);
  expect(idle).toBeLessThan(0.05);

  for (const pose of ['peace', 'double-peace']) {
    const smile = await page.evaluate((name) => {
      window.__char.holdActionForTest(name, 500);
      const value = window.__char.getState().smile;
      window.__char.releaseActionsForTest();
      return value;
    }, pose);
    expect(smile, `${pose} smile`).toBeGreaterThan(0.8);
  }

  const jumping = await page.evaluate(() => {
    window.__char.jumpForTest(200); // ~apex
    return window.__char.getState().smile;
  });
  expect(jumping).toBeGreaterThan(0.5);
});

test('the smile eases in rather than snapping to full on the first frame', async ({ page }) => {
  const early = await page.evaluate(() => {
    window.__char.holdActionForTest('double-peace', 32); // two frames
    const value = window.__char.getState().smile;
    window.__char.releaseActionsForTest();
    return value;
  });
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(0.5);
});

test('the arms hang below the head at rest', async ({ page }) => {
  // A rig-orientation guard. The model is a VRM 0.x export whose normalized
  // skeleton is mirrored against the VRM 1.0 one these poses were written
  // for, and the failure mode is silent and total: every arm rotation
  // inverts, so idle raises both arms straight up instead of letting them
  // hang. Nothing else in the suite would notice.
  const measured = await page.evaluate(() => ({
    head: window.__char.getBoneWorld('head'),
    left: window.__char.getBoneWorld('leftHand'),
    right: window.__char.getBoneWorld('rightHand'),
  }));

  expect(measured.left.y).toBeLessThan(measured.head.y - 0.3);
  expect(measured.right.y).toBeLessThan(measured.head.y - 0.3);
});

test('the character faces the way she walks', async ({ page }) => {
  // Guards the half-turn that rotateVRM0 puts on the scene root: drop it and
  // she still travels the right way, but moonwalks there facing backwards.
  // Her left hand ends up on the wrong side of her, which is what this reads.
  const measured = await page.evaluate(() => {
    window.__char.moveForTest('forward', 400, false); // heading 0, travelling +Z
    return {
      left: window.__char.getBoneWorld('leftHand'),
      right: window.__char.getBoneWorld('rightHand'),
    };
  });
  // Facing +Z, her left hand sits at greater world X than her right.
  expect(measured.left.x).toBeGreaterThan(measured.right.x);
});

test('idle turns the character to face the camera instead of staying at the last movement heading', async ({ page }) => {
  const afterMove = await page.evaluate(() => window.__char.moveForTest('right', 500, false));
  // Give the idle face-camera turn time to settle (it eases in, not instant).
  await page.waitForTimeout(2500);
  const idleState = await page.evaluate(() => window.__char.getState());
  expect(idleState.heading).not.toBeCloseTo(afterMove.heading, 1);
});
