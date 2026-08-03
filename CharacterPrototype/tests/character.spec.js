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
  // MOVE_SPEED is 4.2 units/sec; allow some tolerance for discrete stepping.
  expect(result.position.z).toBeGreaterThan(3.5);
  expect(result.position.z).toBeLessThan(5.0);
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
  // heading = atan2(moveX, moveZ); moving purely left (moveX=-1, moveZ=0) => heading = -PI/2
  expect(result.heading).toBeCloseTo(-Math.PI / 2, 2);
  expect(result.position.x).toBeLessThan(0);
});
