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
  await page.waitForTimeout(400); // still airborne partway through the ~0.65s cycle
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyW');

  expect(midState.animName).toBe('jump'); // jump outranks walk's animName while airborne
  expect(midState.position.z).toBeGreaterThan(0); // but WASD still moved her forward
});

test('idle turns the character to face the camera instead of staying at the last movement heading', async ({ page }) => {
  const afterMove = await page.evaluate(() => window.__char.moveForTest('right', 500, false));
  // Give the idle face-camera turn time to settle (it eases in, not instant).
  await page.waitForTimeout(2500);
  const idleState = await page.evaluate(() => window.__char.getState());
  expect(idleState.heading).not.toBeCloseTo(afterMove.heading, 1);
});
