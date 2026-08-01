const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__darts && window.__darts.ready);
});

test('holding and releasing a tap on the canvas fires a dart and advances the round', async ({ page }) => {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();

  await page.waitForFunction(() => window.__darts.getState().round === 2, null, { timeout: 5000 });
  const state = await page.evaluate(() => window.__darts.getState());
  expect(state.round).toBe(2);
  expect(state.score).toBeGreaterThanOrEqual(0);
});

// Uses a mid-range ratio, not 1 (full power): the tuned power range
// deliberately overshoots the board at max charge, same as a real throw —
// see the comment above MIN_POWER/MAX_POWER in src/main.js for the sweep data.
test('a well-timed throw lands on the board and scores points', async ({ page }) => {
  const score = await page.evaluate(() => window.__darts.fireActionForTest(0.35));
  expect(score).toBeGreaterThan(0);

  const state = await page.evaluate(() => window.__darts.getState());
  expect(state.score).toBe(score);
  expect(state.round).toBe(2);
});

test('game ends after the configured number of rounds', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.evaluate((ratio) => window.__darts.fireActionForTest(ratio), 0.6);
  }

  const state = await page.evaluate(() => window.__darts.getState());
  expect(state.gameOver).toBe(true);

  const roundText = await page.locator('#round').textContent();
  expect(roundText).toContain('Finished');
});

// Exercises the collision-pair bug: firing several shots in a row leaves old,
// already-landed darts in the physics world, so later collisions can involve
// two same-labeled bodies at once. A hang here (instead of completing) means
// that bug is back.
test('firing multiple darts in a row never hangs', async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    const score = await page.evaluate((ratio) => window.__darts.fireActionForTest(ratio), 0.5);
    expect(score === null || typeof score === 'number').toBe(true);
  }
});

test('firing while a dart is still in flight is ignored', async ({ page }) => {
  const firstThrow = page.evaluate(() => window.__darts.fireActionForTest(0.05));
  await page.waitForTimeout(20);
  const secondResult = await page.evaluate(() => window.__darts.fireActionForTest(1));

  expect(secondResult).toBeNull();
  await firstThrow;
});
