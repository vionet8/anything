const { test, expect } = require('@playwright/test');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const files = (names) => names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG }));

async function newTournament(page, title, names) {
  await page.click('#new-tournament');
  await page.fill('#title', title);
  await page.setInputFiles('#file-input', files(names));
  await expect(page.locator('#entry-list .entry')).toHaveCount(names.length);
  await page.click('#start');
  await expect(page.locator('#view-match')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__pt && window.__pt.ready);
});

test('写真を入れてタップし続けると、1枚の優勝写真が残る', async ({ page }) => {
  await newTournament(page, '娘の誕生日プレゼント', ['くま.png', 'えほん.png', 'じてんしゃ.png']);

  const state = await page.evaluate(() => window.__pt.getState());
  expect(state.entries).toBe(3);
  expect(state.progress.total).toBe(2); // 3枚なら2試合

  await page.click('#card-a');
  await page.click('#card-a');

  await expect(page.locator('#view-result')).toBeVisible();
  await expect(page.locator('#champ-name')).not.toBeEmpty();
  await expect(page.locator('#rank li')).toHaveCount(3);
  await expect(page.locator('#rank li').first()).toContainText('優勝');
});

test('決勝まで来ても写真の名前は入力したものが出る', async ({ page }) => {
  await newTournament(page, '旅行先', ['沖縄.png', '北海道.png']);
  const nameA = await page.locator('#name-a').textContent();
  await page.click('#card-a');
  await expect(page.locator('#champ-name')).toHaveText(nameA);
});

test('1つ戻すと直前の対戦をやり直せる', async ({ page }) => {
  await newTournament(page, 'おやつ', ['a.png', 'b.png', 'c.png', 'd.png']);
  const before = await page.evaluate(() => window.__pt.getState().current.id);
  await page.click('#card-a');
  await expect(page.locator('#match-count')).toContainText('2 / 3');
  await page.click('#undo');
  const after = await page.evaluate(() => window.__pt.getState().current.id);
  expect(after).toBe(before);
  await expect(page.locator('#match-count')).toContainText('1 / 3');
});

test('中断してもリロード後に写真ごと残り、途中から再開できる', async ({ page }) => {
  await newTournament(page, '来年の旅行先', ['京都.png', '金沢.png', '別府.png', '屋久島.png']);
  await page.click('#card-a');
  await page.click('#pause');
  await expect(page.locator('#view-home')).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => window.__pt && window.__pt.ready);
  const item = page.locator('#history li').first();
  await expect(item).toContainText('来年の旅行先');
  await expect(item).toContainText('進行中 1 / 3 試合');

  await item.locator('.meta').click();
  await expect(page.locator('#view-match')).toBeVisible();
  await expect(page.locator('#match-count')).toContainText('2 / 3');
  // 保存した写真がそのまま表示されている
  await expect(page.locator('#img-a')).toHaveJSProperty('naturalWidth', 1);
});

test('終わった大会は優勝写真つきで履歴に残り、同じ写真で再戦できる', async ({ page }) => {
  await newTournament(page, 'ケーキ', ['いちご.png', 'チョコ.png']);
  await page.click('#card-a');
  const champ = await page.locator('#champ-name').textContent();

  await page.click('#replay');
  await expect(page.locator('#view-match')).toBeVisible();
  await page.click('#card-b');
  await page.click('#result-home');

  const items = page.locator('#history li');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('ケーキ');
  await expect(items.nth(1)).toContainText(`優勝：${champ}`);
});

test('ホーム画面では「ホーム」ボタンを出さない', async ({ page }) => {
  await expect(page.locator('#to-home')).toBeHidden();
  await newTournament(page, 'おでかけ先', ['公園.png', 'water.png']);
  await expect(page.locator('#to-home')).toBeVisible();
  await page.click('#to-home');
  await expect(page.locator('#to-home')).toBeHidden();
});
