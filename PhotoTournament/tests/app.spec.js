const { test, expect } = require('@playwright/test');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const files = (names) => names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG }));

// 連打よけの待ち時間を挟んでからタップする（実機で押せるようになる瞬間と同じ条件）
async function tap(page, selector) {
  await page.waitForFunction(() => window.__pt.canPick());
  await page.click(selector);
}

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

  await tap(page, '#card-a');
  await tap(page, '#card-a');

  await expect(page.locator('#view-result')).toBeVisible();
  await expect(page.locator('#champ-name')).not.toBeEmpty();
  await expect(page.locator('#rank li')).toHaveCount(3);
  await expect(page.locator('#rank li').first()).toContainText('優勝');
});

test('決勝まで来ても写真の名前は入力したものが出る', async ({ page }) => {
  await newTournament(page, '旅行先', ['沖縄.png', '北海道.png']);
  const nameA = await page.locator('#name-a').textContent();
  await tap(page, '#card-a');
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
  await tap(page, '#card-b');
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

test('素早い連打でも1試合ずつしか進まない', async ({ page }) => {
  await newTournament(page, 'アイス', ['a.png', 'b.png', 'c.png', 'd.png']);
  await page.dblclick('#card-a');
  await expect(page.locator('#match-count')).toContainText('2 / 3');
  expect(await page.evaluate(() => window.__pt.getState().progress.done)).toBe(1);
});

test('ホーム画面に追加するための情報とアイコンが揃っている', async ({ page }) => {
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const json = await manifest.json();
  expect(json.name).toBe('写真トーナメント');
  expect(json.display).toBe('standalone');
  expect(json.start_url).toBe('./');

  for (const icon of [...json.icons.map((i) => i.src), 'icons/apple-touch-icon.png']) {
    const res = await page.request.get(`/${icon}`);
    expect(res.status(), icon).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
});

test('電波がなくても、一度開いていれば起動して大会を続けられる', async ({ page, context }) => {
  await newTournament(page, '週末の行き先', ['海.png', '山.png', '動物園.png']);
  await tap(page, '#card-a');
  await page.click('#pause');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__pt && window.__pt.ready);

  await expect(page.locator('#history li').first()).toContainText('週末の行き先');
  await page.locator('#history li').first().locator('.meta').click();
  await expect(page.locator('#view-match')).toBeVisible();
  await expect(page.locator('#img-a')).toHaveJSProperty('naturalWidth', 1);
  await context.setOffline(false);
});
