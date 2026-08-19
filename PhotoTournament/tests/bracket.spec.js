const { test, expect } = require('@playwright/test');
const Bracket = require('../src/bracket.js');

const entries = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `写真${i}` }));

function playAll(t, pick) {
  let guard = 0;
  while (!Bracket.isFinished(t) && guard++ < 200) {
    const m = Bracket.currentMatch(t);
    Bracket.pickWinner(t, m.id, pick(m));
  }
  return t;
}

test('2のべき乗でない枚数でも、不戦勝を混ぜて必ず1枚に絞れる', () => {
  for (const n of [2, 3, 5, 6, 7, 9, 13, 17]) {
    const t = Bracket.createTournament(entries(n), { shuffle: false });
    expect(t.size).toBe(Bracket.nextPowerOfTwo(n));
    // 人がタップする試合数は「枚数 - 1」。不戦勝はタップさせない。
    expect(Bracket.progress(t).total).toBe(n - 1);
    playAll(t, (m) => m.a);
    expect(Bracket.champion(t)).toBeTruthy();
    expect(Bracket.ranking(t)).toHaveLength(n);
  }
});

test('1回戦で写真どうしがぶつからない不戦勝はなく、同じ写真が二度出ない', () => {
  const t = Bracket.createTournament(entries(5), { shuffle: false });
  const firstRound = t.matches.filter((m) => m.round === 0);
  expect(firstRound.every((m) => m.a || m.b)).toBe(true); // 空 vs 空 の試合は作らない
  const seen = firstRound.flatMap((m) => [m.a, m.b]).filter(Boolean);
  expect(new Set(seen).size).toBe(5);
});

test('1つ戻すと直前の選択だけが取り消され、勝ち上がりも巻き戻る', () => {
  const t = Bracket.createTournament(entries(4), { shuffle: false });
  const first = Bracket.currentMatch(t);
  Bracket.pickWinner(t, first.id, first.a);
  const second = Bracket.currentMatch(t);
  Bracket.pickWinner(t, second.id, second.a);

  const final = t.matches[t.matches.length - 1];
  expect(final.a).toBe(first.a);
  expect(final.b).toBe(second.a);

  Bracket.undo(t);
  expect(Bracket.currentMatch(t).id).toBe(second.id);
  expect(t.matches[t.matches.length - 1].b).toBe(null);
  expect(t.matches[t.matches.length - 1].a).toBe(first.a); // 取り消していない側は残る
});

test('順位は負けたラウンドの遅い順に並ぶ', () => {
  const t = Bracket.createTournament(entries(4), { shuffle: false });
  playAll(t, (m) => m.a);
  const rank = Bracket.ranking(t);
  expect(rank.map((r) => r.label)).toEqual(['優勝', '準優勝', 'ベスト4', 'ベスト4']);
  expect(rank[0].entry.id).toBe(Bracket.champion(t));
});

test('選び直しても、決勝の顔ぶれは選んだとおりに入れ替わる', () => {
  const t = Bracket.createTournament(entries(4), { shuffle: false });
  const first = Bracket.currentMatch(t);
  Bracket.pickWinner(t, first.id, first.b);
  expect(t.matches[t.matches.length - 1].a).toBe(first.b);
  Bracket.undo(t);
  Bracket.pickWinner(t, first.id, first.a);
  expect(t.matches[t.matches.length - 1].a).toBe(first.a);
});
