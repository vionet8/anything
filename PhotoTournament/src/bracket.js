// トーナメント表の組み立てと進行。DOM にも保存方式にも依存しない純粋なロジックなので、
// ブラウザからも Node のテストからも同じものを読み込んで使う。
(function (root) {
  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  // 標準的なトーナメントのシード順（1 の相手が最下位シード、という並びを再帰的に作る）。
  // 出場者が 2 のべき乗に足りないときの不戦勝が、山ごとに散らばってくれる。
  function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const len = order.length * 2;
      const next = [];
      for (const seed of order) {
        next.push(seed);
        next.push(len + 1 - seed);
      }
      order = next;
    }
    return order;
  }

  function shuffle(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function roundName(round, totalRounds) {
    const fromEnd = totalRounds - 1 - round;
    if (fromEnd === 0) return '決勝';
    if (fromEnd === 1) return '準決勝';
    if (fromEnd === 2) return '準々決勝';
    return `${round + 1}回戦`;
  }

  // entries: [{ id, name }] を受け取り、進行状態を持つ大会オブジェクトを返す。
  function createTournament(entries, options) {
    const opts = options || {};
    const rng = opts.rng || Math.random;
    const ordered = opts.shuffle === false ? entries.slice() : shuffle(entries, rng);
    const size = Math.max(2, nextPowerOfTwo(ordered.length));
    const totalRounds = Math.log2(size);
    const slots = seedOrder(size).map((seed) => (ordered[seed - 1] ? ordered[seed - 1].id : null));

    const matches = [];
    for (let round = 0; round < totalRounds; round++) {
      const count = size / Math.pow(2, round + 1);
      for (let index = 0; index < count; index++) {
        matches.push({
          id: `r${round}m${index}`,
          round,
          index,
          a: round === 0 ? slots[index * 2] : null,
          b: round === 0 ? slots[index * 2 + 1] : null,
          winner: null,
          auto: false,
        });
      }
    }

    const tournament = {
      entries: ordered,
      size,
      totalRounds,
      matches,
      picks: [], // 人が選んだ結果だけを順に持つ。表の状態はここから再計算する。
    };
    recompute(tournament);
    return tournament;
  }

  // picks から勝ち上がりを組み直す。undo は picks を削って再計算するだけで済む。
  function recompute(t) {
    const decided = new Map(t.picks.map((p) => [p.matchId, p.winnerId]));
    const byId = new Map(t.matches.map((m) => [m.id, m]));

    for (const m of t.matches) {
      m.winner = null;
      m.auto = false;
      if (m.round > 0) {
        m.a = null;
        m.b = null;
      }
    }

    for (const m of t.matches) {
      if (m.a && m.b) {
        const picked = decided.get(m.id);
        if (picked === m.a || picked === m.b) m.winner = picked;
      } else if (m.round === 0 && (m.a || m.b)) {
        // 不戦勝。1回戦以外では、まだ埋まっていないだけなので勝者は決めない。
        m.winner = m.a || m.b;
        m.auto = true;
      }
      if (!m.winner) continue;
      const next = byId.get(`r${m.round + 1}m${Math.floor(m.index / 2)}`);
      if (next) next[m.index % 2 === 0 ? 'a' : 'b'] = m.winner;
    }
  }

  function currentMatch(t) {
    return t.matches.find((m) => m.a && m.b && !m.winner) || null;
  }

  function pickWinner(t, matchId, winnerId) {
    const match = t.matches.find((m) => m.id === matchId);
    if (!match || match.winner) return false;
    if (winnerId !== match.a && winnerId !== match.b) return false;
    t.picks.push({ matchId, winnerId });
    recompute(t);
    return true;
  }

  function undo(t) {
    if (!t.picks.length) return false;
    t.picks.pop();
    recompute(t);
    return true;
  }

  function progress(t) {
    const total = t.matches.filter((m) => !m.auto).length;
    return { done: t.picks.length, total };
  }

  function isFinished(t) {
    return Boolean(champion(t));
  }

  function champion(t) {
    const final = t.matches[t.matches.length - 1];
    return final ? final.winner : null;
  }

  // 優勝から順に、負けたラウンドが遅い人ほど上位。
  function ranking(t) {
    const lostAt = new Map();
    for (const m of t.matches) {
      if (!m.winner) continue;
      const loser = m.winner === m.a ? m.b : m.a;
      if (loser) lostAt.set(loser, m.round);
    }
    const rows = t.entries.map((entry) => ({
      entry,
      lostRound: lostAt.has(entry.id) ? lostAt.get(entry.id) : null,
    }));
    rows.sort((x, y) => {
      if (x.lostRound === null) return -1;
      if (y.lostRound === null) return 1;
      return y.lostRound - x.lostRound;
    });
    return rows.map((row) => ({
      entry: row.entry,
      label:
        row.lostRound === null
          ? '優勝'
          : row.lostRound === t.totalRounds - 1
            ? '準優勝'
            : `ベスト${Math.pow(2, t.totalRounds - row.lostRound)}`,
    }));
  }

  const api = {
    nextPowerOfTwo,
    seedOrder,
    roundName,
    createTournament,
    recompute,
    currentMatch,
    pickWinner,
    undo,
    progress,
    isFinished,
    champion,
    ranking,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Bracket = api;
})(typeof window !== 'undefined' ? window : null);
