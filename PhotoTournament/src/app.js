(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_EDGE = 1400; // スマホの写真をそのまま入れると重いので、この大きさまで縮める
  const TAP_LOCK_MS = 250; // 連打で次の対戦まで勝手に決まってしまうのを防ぐ

  let record = null; // 保存する形（写真そのものと、選んだ結果の並び）
  let tournament = null; // 表の進行状態。record から組み直せる
  let draft = []; // 準備中の出場写真
  let view = 'home';
  let lockedUntil = 0;
  const urls = new Map();

  function photoUrl(entry) {
    if (!entry || !entry.photo) return '';
    if (!urls.has(entry.id)) urls.set(entry.id, URL.createObjectURL(entry.photo));
    return urls.get(entry.id);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function showView(name) {
    view = name;
    for (const section of document.querySelectorAll('.view')) {
      section.classList.toggle('active', section.id === `view-${name}`);
    }
    $('to-home').hidden = name === 'home';
    window.scrollTo(0, 0);
  }

  // ---- 写真の取り込み -------------------------------------------------

  async function shrink(file) {
    try {
      // スマホの写真は撮った向きが EXIF にしか入っていないことがあるので、それを反映させる
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) return blob;
    } catch (err) {
      console.warn('写真を縮小できなかったので元のまま使います', err);
    }
    return file;
  }

  async function addFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      draft.push({
        id: uid(),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || `写真${draft.length + 1}`,
        photo: await shrink(file),
      });
      renderSetup();
    }
  }

  // ---- 準備画面 -------------------------------------------------------

  function renderSetup() {
    const list = $('entry-list');
    list.textContent = '';
    draft.forEach((entry, i) => {
      const box = document.createElement('div');
      box.className = 'entry';

      const img = document.createElement('img');
      img.src = photoUrl(entry);
      img.alt = entry.name;

      const name = document.createElement('input');
      name.className = 'name';
      name.value = entry.name;
      name.setAttribute('aria-label', `${i + 1}枚目の名前`);
      name.addEventListener('input', () => { entry.name = name.value; });

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = '削除';
      remove.addEventListener('click', () => {
        draft = draft.filter((e) => e.id !== entry.id);
        renderSetup();
      });

      box.append(img, name, remove);
      list.append(box);
    });

    $('entry-count').textContent =
      draft.length >= 2
        ? `${draft.length}枚。${draft.length}枚でトーナメントを組みます。`
        : `${draft.length}枚。2枚以上でトーナメントを始められます。`;
    $('start').disabled = draft.length < 2;
  }

  // ---- 対戦画面 -------------------------------------------------------

  function entryOf(id) {
    return tournament.entries.find((e) => e.id === id) || null;
  }

  function renderMatch() {
    const match = Bracket.currentMatch(tournament);
    if (!match) {
      renderResult();
      showView('result');
      return;
    }
    const { done, total } = Bracket.progress(tournament);
    $('round-name').textContent = Bracket.roundName(match.round, tournament.totalRounds);
    $('match-count').textContent = `${done + 1} / ${total} 試合`;
    $('bar-fill').style.width = `${(done / total) * 100}%`;

    for (const side of ['a', 'b']) {
      const entry = entryOf(match[side]);
      $(`img-${side}`).src = photoUrl(entry);
      $(`img-${side}`).alt = entry ? entry.name : '';
      $(`name-${side}`).textContent = entry ? entry.name : '';
      $(`card-${side}`).onclick = () => choose(match.id, match[side]);
    }
    $('undo').disabled = tournament.picks.length === 0;
    replayEnterAnimation();
    showView('match');
  }

  function replayEnterAnimation() {
    const versus = $('versus');
    versus.classList.remove('enter');
    void versus.offsetWidth; // 一度止めないと同じアニメーションが再生されない
    versus.classList.add('enter');
  }

  function choose(matchId, winnerId) {
    if (Date.now() < lockedUntil) return; // 入れ替わった直後の連打は数えない
    if (!Bracket.pickWinner(tournament, matchId, winnerId)) return;
    lockedUntil = Date.now() + TAP_LOCK_MS;
    record.picks = tournament.picks.slice();
    persist();
    if (Bracket.isFinished(tournament)) {
      renderResult();
      showView('result');
    } else {
      renderMatch();
    }
  }

  // ---- 結果画面 -------------------------------------------------------

  function renderResult() {
    const winner = entryOf(Bracket.champion(tournament));
    $('champ-img').src = photoUrl(winner);
    $('champ-img').alt = winner ? winner.name : '';
    $('champ-name').textContent = winner ? winner.name : '';

    const rank = $('rank');
    rank.textContent = '';
    for (const row of Bracket.ranking(tournament)) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = photoUrl(row.entry);
      img.alt = '';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = row.label;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = row.entry.name;
      li.append(img, label, who);
      rank.append(li);
    }
  }

  // ---- 保存と履歴 -----------------------------------------------------

  function persist() {
    record.updatedAt = Date.now();
    return Store.save({
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      entries: record.entries.map((e) => ({ id: e.id, name: e.name, photo: e.photo })),
      picks: record.picks,
    });
  }

  function load(row) {
    record = {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      entries: row.entries,
      picks: row.picks.slice(),
    };
    tournament = Bracket.createTournament(record.entries, { shuffle: false });
    tournament.picks = record.picks.slice();
    Bracket.recompute(tournament);
    if (Bracket.isFinished(tournament)) {
      renderResult();
      showView('result');
    } else {
      renderMatch();
    }
  }

  function summarise(row) {
    const t = Bracket.createTournament(row.entries, { shuffle: false });
    t.picks = row.picks.slice();
    Bracket.recompute(t);
    const champId = Bracket.champion(t);
    const champ = row.entries.find((e) => e.id === champId);
    const { done, total } = Bracket.progress(t);
    return {
      cover: champ || row.entries[0],
      text: champ
        ? `優勝：${champ.name}・${row.entries.length}枚`
        : `進行中 ${done} / ${total} 試合・${row.entries.length}枚`,
    };
  }

  async function renderHome() {
    const rows = await Store.list();
    const list = $('history');
    list.textContent = '';
    $('history-empty').hidden = rows.length > 0;

    for (const row of rows) {
      const info = summarise(row);
      const li = document.createElement('li');

      const img = document.createElement('img');
      img.src = photoUrl(info.cover);
      img.alt = '';

      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = row.title || '無題の大会';
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${new Date(row.createdAt).toLocaleDateString('ja-JP')}・${info.text}`;
      meta.append(title, sub);
      meta.addEventListener('click', () => load(row));

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '削除';
      del.addEventListener('click', async () => {
        if (!window.confirm(`「${row.title || '無題の大会'}」を写真ごと削除します。よろしいですか？`)) return;
        await Store.remove(row.id);
        renderHome();
      });

      li.append(img, meta, del);
      list.append(li);
    }
    showView('home');
  }

  // ---- 画面の切り替え -------------------------------------------------

  $('new-tournament').addEventListener('click', () => {
    draft = [];
    $('title').value = '';
    renderSetup();
    showView('setup');
  });

  $('add-photos').addEventListener('click', () => $('file-input').click());

  $('file-input').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await addFiles(files);
  });

  $('start').addEventListener('click', () => {
    if (draft.length < 2) return;
    tournament = Bracket.createTournament(draft, { shuffle: true });
    record = {
      id: uid(),
      title: $('title').value.trim() || `大会 ${new Date().toLocaleDateString('ja-JP')}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entries: tournament.entries,
      picks: [],
    };
    persist();
    renderMatch();
  });

  $('undo').addEventListener('click', () => {
    if (!Bracket.undo(tournament)) return;
    record.picks = tournament.picks.slice();
    persist();
    renderMatch();
  });

  $('pause').addEventListener('click', () => {
    persist().then(renderHome);
  });

  $('to-home').addEventListener('click', () => {
    if (record) persist().then(renderHome);
    else renderHome();
  });

  $('result-home').addEventListener('click', () => renderHome());

  $('replay').addEventListener('click', () => {
    tournament = Bracket.createTournament(record.entries, { shuffle: true });
    record = {
      id: uid(),
      title: record.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entries: tournament.entries,
      picks: [],
    };
    persist();
    renderMatch();
  });

  // テストから進行を確かめるための入口
  window.__pt = {
    ready: true,
    getView: () => view,
    canPick: () => Date.now() >= lockedUntil,
    getState: () => {
      if (!tournament) return null;
      const match = Bracket.currentMatch(tournament);
      return {
        title: record ? record.title : null,
        entries: tournament.entries.length,
        size: tournament.size,
        progress: Bracket.progress(tournament),
        champion: Bracket.champion(tournament),
        current: match ? { id: match.id, a: match.a, b: match.b, round: match.round } : null,
      };
    },
    pickSide: (side) => {
      const match = Bracket.currentMatch(tournament);
      if (!match) return false;
      choose(match.id, match[side]);
      return true;
    },
  };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('オフライン用の準備ができませんでした', err);
      });
    });
  }

  renderHome();
})();
