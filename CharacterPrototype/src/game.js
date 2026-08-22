// The photo game.
//
// A client asks for a shot -- a pose, a face, and how tight to frame it -- and
// you direct her and press the shutter. The score is measured off the same
// scene the picture was taken from: which pose she was actually in, which
// expression she was actually wearing, and where her head actually landed in
// the frame. Nothing here guesses.
//
// The UI is built in script rather than written into the page, because there
// are two pages (the dev page and the published artifact) and a HUD written
// twice is a HUD that drifts.

export const POSES = [
  { key: 'peace', label: 'ピース', hint: 'V' },
  { key: 'double-peace', label: 'ダブルピース', hint: 'B' },
  { key: 'wave', label: '手を振る', hint: 'E' },
  { key: 'crouch', label: 'しゃがむ', hint: 'C' },
  { key: 'idle', label: '自然体', hint: '—' },
];

export const EXPRESSIONS = [
  { key: 'happy', label: '笑顔', hint: '1' },
  { key: 'relaxed', label: 'にっこり', hint: '2' },
  { key: 'Surprised', label: '驚き', hint: '3' },
  { key: 'angry', label: '怒り', hint: '4' },
  { key: 'sad', label: '悲しい', hint: '5' },
  { key: 'Extra', label: '>_<', hint: '6' },
];

// How much of the frame's height her head should fill. Measured off the real
// projection rather than picked out of the air -- tools/measure_framing.js
// prints the number at a range of camera distances, and the camera can reach
// 23% of the frame at its closest and 1.6% at its furthest. The bands sit
// inside that with gaps between them, so landing one means you framed it
// rather than happened to be nearby.
export const FRAMINGS = [
  { key: 'close', label: '寄り', min: 0.130, max: 0.250 },   // ~1.3m and closer
  { key: 'medium', label: '標準', min: 0.055, max: 0.105 },  // ~2m to 3m
  { key: 'wide', label: '引き', min: 0.020, max: 0.040 },    // ~4m to 8.5m
];

const SHOTS_PER_SESSION = 3;

// What each part of the brief is worth. Pose and face are the request; framing
// is the part that is actually yours to get right, so it carries as much
// weight as the two of them together.
const POINTS = { pose: 25, expression: 25, inFrame: 15, framing: 20, centred: 15 };
const STAR_THRESHOLDS = [85, 60, 30];   // 3 stars, 2 stars, 1 star

// An expression that has only just started easing in is not the expression she
// is wearing yet.
const EXPRESSION_SETTLED = 0.6;

const byKey = (list, key) => list.find((entry) => entry.key === key);

export function scoreShot(request, shot) {
  const framing = shot.framing;
  const band = byKey(FRAMINGS, request.framing);
  const parts = [];

  const poseOk = shot.state.animName === request.pose;
  parts.push({ key: 'pose', label: 'ポーズ', ok: poseOk, points: poseOk ? POINTS.pose : 0 });

  const expressionOk = shot.state.expression === request.expression
    && shot.state.expressionWeight >= EXPRESSION_SETTLED;
  parts.push({
    key: 'expression', label: '表情', ok: expressionOk, points: expressionOk ? POINTS.expression : 0,
  });

  const inFrame = !!framing && !framing.behindCamera
    && Math.abs(framing.x) < 0.45 && Math.abs(framing.y) < 0.45;
  parts.push({ key: 'inFrame', label: '顔が写っている', ok: inFrame, points: inFrame ? POINTS.inFrame : 0 });

  const framingOk = inFrame && framing.faceSize >= band.min && framing.faceSize <= band.max;
  parts.push({
    key: 'framing', label: band.label, ok: framingOk, points: framingOk ? POINTS.framing : 0,
  });

  // Centring is the one part that is not pass/fail: dead centre scores full,
  // and it falls off to nothing at the edge of the frame. A photo can be a
  // little off-centre and still be a good photo.
  const offCentre = inFrame ? Math.hypot(framing.x, framing.y) : 1;
  const centred = Math.max(0, 1 - offCentre / 0.35);
  parts.push({
    key: 'centred', label: '構図', ok: centred > 0.5,
    points: Math.round(POINTS.centred * centred),
  });

  const total = parts.reduce((sum, part) => sum + part.points, 0);
  const rank = STAR_THRESHOLDS.findIndex((threshold) => total >= threshold);
  let stars = rank === -1 ? 0 : 3 - rank;
  // A beautifully framed photo of the wrong pose is not a good photo. Framing
  // alone can reach 50 points, which would otherwise buy two stars for a shot
  // that ignored the brief entirely.
  if (!(poseOk && expressionOk)) stars = Math.min(stars, 1);
  return { total, stars, parts };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function makeRequest() {
  return {
    pose: pick(POSES).key,
    expression: pick(EXPRESSIONS).key,
    framing: pick(FRAMINGS).key,
  };
}

export function describeRequest(request) {
  return {
    pose: byKey(POSES, request.pose),
    expression: byKey(EXPRESSIONS, request.expression),
    framing: byKey(FRAMINGS, request.framing),
  };
}

const STYLE = `
.pg-root { position: fixed; inset: 0; pointer-events: none; z-index: 5;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif;
  color: #e8ebf2; }
.pg-root * { box-sizing: border-box; }
.pg-panel { position: absolute; top: 16px; right: 16px; width: min(280px, calc(100vw - 32px));
  background: rgba(22, 25, 34, 0.9); border: 1px solid #2a3040; border-radius: 6px;
  padding: 12px 14px; pointer-events: auto; backdrop-filter: blur(6px); }
.pg-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #ffb454;
  margin: 0 0 8px; font-family: ui-monospace, Menlo, Consolas, monospace; }
.pg-brief { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.pg-chip { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
  background: #0c0e14; border: 1px solid #2a3040; }
.pg-chip[data-ok="true"] { border-color: #7ee787; color: #7ee787; }
.pg-chip small { font-weight: 400; color: #8b93a7; margin-left: 4px; }
.pg-count { font-size: 11px; color: #8b93a7; font-family: ui-monospace, Menlo, Consolas, monospace; }
.pg-cast { display: flex; gap: 6px; margin-top: 10px; }
.pg-pick { flex: 1; padding: 8px 0; font: inherit; font-size: 13px; font-weight: 600;
  color: #8b93a7; background: #0c0e14; border: 1px solid #2a3040; border-radius: 6px;
  cursor: pointer; }
.pg-pick[data-on="true"] { color: #0c0e14; background: #e8ebf2; border-color: #e8ebf2; }
.pg-button { display: block; width: 100%; margin-top: 10px; padding: 10px; font: inherit;
  font-size: 14px; font-weight: 600; color: #0c0e14; background: #ffb454; border: 0;
  border-radius: 6px; cursor: pointer; pointer-events: auto; }
.pg-button:disabled { opacity: 0.45; cursor: default; }
.pg-button.pg-ghost { color: #e8ebf2; background: transparent; border: 1px solid #2a3040; }
.pg-shutter { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%);
  width: 68px; height: 68px; border-radius: 50%; background: #ffb454; border: 4px solid #0c0e14;
  box-shadow: 0 0 0 2px #ffb454; cursor: pointer; pointer-events: auto; }
.pg-shutter:active { transform: translateX(-50%) scale(0.94); }
.pg-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.pg-flash.pg-firing { animation: pg-flash 0.4s ease-out; }
@keyframes pg-flash { from { opacity: 0.85; } to { opacity: 0; } }
.pg-sheet { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 10, 16, 0.82); pointer-events: auto; padding: 20px; overflow-y: auto; }
.pg-card { width: min(420px, 100%); background: #161922; border: 1px solid #2a3040;
  border-radius: 8px; padding: 20px; text-align: center; }
.pg-card h2 { margin: 0 0 4px; font-size: 18px; }
.pg-card p { margin: 0 0 14px; font-size: 13px; color: #8b93a7; line-height: 1.6; }
.pg-stars { font-size: 30px; letter-spacing: 6px; color: #ffb454; margin: 6px 0; }
.pg-total { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 26px; font-weight: 700; }
.pg-parts { list-style: none; margin: 12px 0; padding: 0; text-align: left; }
.pg-parts li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0;
  font-size: 13px; border-bottom: 1px solid #232838; }
.pg-parts li[data-ok="false"] { color: #8b93a7; }
/* A fixed box rather than one that grows to the image: the photo is a data URL
   that decodes a moment after the card is built, and sizing to it makes the
   whole card jump — and the button under it move out from under the cursor. */
.pg-shot { width: 100%; height: 44vh; object-fit: contain; border-radius: 6px;
  border: 1px solid #2a3040; display: block; background: #0c0e14; }
.pg-album { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0; }
.pg-album img { width: 100%; border-radius: 4px; border: 1px solid #2a3040; display: block; }
/* On a narrow screen the top corners belong to the controls panel, so the
   brief moves down beside the shutter rather than sitting on top of it. */
@media (max-width: 560px) {
  .pg-panel { top: auto; bottom: 104px; left: 16px; right: 16px; width: auto; }
  .pg-card { padding: 14px; }
}
@media (prefers-reduced-motion: reduce) { .pg-flash.pg-firing { animation: none; } }
`;

export function initPhotoGame(api) {
  const root = document.createElement('div');
  root.className = 'pg-root';
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.body.appendChild(root);

  // Starts in 'free' rather than behind a title card: the page is a character
  // sandbox as well as a game, and a modal over the canvas on load takes the
  // camera drag away from anyone who just wants to look at her.
  const session = { shots: [], request: null, phase: 'free' };

  const el = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  function render() {
    root.innerHTML = '';
    if (session.phase === 'free') return renderFree();
    if (session.phase === 'shooting') return renderShooting();
    if (session.phase === 'result') return renderResult();
    if (session.phase === 'album') return renderAlbum();
  }

  function renderFree() {
    const panel = el('div', 'pg-panel');
    panel.append(
      el('p', 'pg-label', '撮影会'),
      el('p', 'pg-count', `お題どおりのポーズと表情をさせて、${SHOTS_PER_SESSION}枚撮ります。`),
    );
    panel.append(renderCastPicker());
    const start = el('button', 'pg-button', '撮影を始める');
    start.addEventListener('click', () => {
      session.shots = [];
      nextRequest();
    });
    panel.append(start);
    root.append(panel);
  }

  // Only offered between sessions: swapping the model mid-brief would reset
  // the pose she is holding, and the shot you were lining up with it.
  function renderCastPicker() {
    const row = el('div', 'pg-cast');
    const cast = api.listCast ? api.listCast() : [];
    if (cast.length < 2) return row;
    const current = api.getCharacter ? api.getCharacter() : null;
    for (const member of cast) {
      const button = el('button', 'pg-pick', member.label);
      button.dataset.on = String(member.key === current);
      button.addEventListener('click', () => {
        api.setCharacter(member.key);
        render();
      });
      row.append(button);
    }
    return row;
  }

  function renderShooting() {
    const panel = el('div', 'pg-panel');
    const described = describeRequest(session.request);
    panel.append(el('p', 'pg-label', 'お題'));

    const brief = el('div', 'pg-brief');
    const live = api.getState();
    const chips = [
      { entry: described.pose, ok: live.animName === session.request.pose },
      {
        entry: described.expression,
        ok: live.expression === session.request.expression
          && live.expressionWeight >= EXPRESSION_SETTLED,
      },
      { entry: described.framing, ok: framingLive() },
    ];
    for (const chip of chips) {
      const node = el('span', 'pg-chip',
        `${chip.entry.label}${chip.entry.hint ? `<small>${chip.entry.hint}</small>` : ''}`);
      node.dataset.ok = String(chip.ok);
      brief.append(node);
    }
    panel.append(brief);
    panel.append(el('p', 'pg-count', `${session.shots.length + 1} / ${SHOTS_PER_SESSION} 枚目`));
    root.append(panel);

    const shutter = el('button', 'pg-shutter');
    shutter.setAttribute('aria-label', 'シャッター');
    shutter.addEventListener('click', shoot);
    root.append(shutter, el('div', 'pg-flash'));
  }

  function framingLive() {
    const framing = api.measureFraming();
    if (!framing || framing.behindCamera) return false;
    const band = byKey(FRAMINGS, session.request.framing);
    return framing.faceSize >= band.min && framing.faceSize <= band.max
      && Math.abs(framing.x) < 0.45 && Math.abs(framing.y) < 0.45;
  }

  function renderResult() {
    const shot = session.shots[session.shots.length - 1];
    const sheet = el('div', 'pg-sheet');
    const card = el('div', 'pg-card');
    const image = el('img', 'pg-shot');
    image.src = shot.dataUrl;
    image.alt = '撮影した写真';
    card.append(
      image,
      el('div', 'pg-stars', '★'.repeat(shot.score.stars) + '☆'.repeat(3 - shot.score.stars)),
      el('div', 'pg-total', `${shot.score.total}`),
    );
    const list = el('ul', 'pg-parts');
    for (const part of shot.score.parts) {
      const item = el('li', null, `<span>${part.label}</span><span>${part.points}</span>`);
      item.dataset.ok = String(part.ok);
      list.append(item);
    }
    card.append(list);
    const next = el('button', 'pg-button',
      session.shots.length >= SHOTS_PER_SESSION ? '結果を見る' : '次のお題へ');
    next.addEventListener('click', () => {
      if (session.shots.length >= SHOTS_PER_SESSION) {
        session.phase = 'album';
        render();
      } else {
        nextRequest();
      }
    });
    card.append(next);
    sheet.append(card);
    root.append(sheet);
    next.focus();
  }

  function renderAlbum() {
    const total = session.shots.reduce((sum, shot) => sum + shot.score.total, 0);
    const stars = session.shots.reduce((sum, shot) => sum + shot.score.stars, 0);
    const sheet = el('div', 'pg-sheet');
    const card = el('div', 'pg-card');
    card.append(el('h2', null, '撮影終了'), el('p', null, `★ ${stars} / ${SHOTS_PER_SESSION * 3}`));
    const album = el('div', 'pg-album');
    for (const shot of session.shots) {
      const image = el('img');
      image.src = shot.dataUrl;
      image.alt = '撮影した写真';
      album.append(image);
    }
    card.append(album, el('div', 'pg-total', `${total}`));
    const again = el('button', 'pg-button', 'もう一度');
    again.addEventListener('click', () => {
      session.shots = [];
      nextRequest();
    });
    const quit = el('button', 'pg-button pg-ghost', 'やめる');
    quit.addEventListener('click', () => { session.phase = 'free'; render(); });
    card.append(again, quit);
    sheet.append(card);
    root.append(sheet);
    again.focus();
  }

  function nextRequest() {
    session.request = makeRequest();
    session.phase = 'shooting';
    render();
  }

  function shoot() {
    const flash = root.querySelector('.pg-flash');
    if (flash) flash.classList.add('pg-firing');
    api.takePhoto((shot) => {
      shot.score = scoreShot(session.request, shot);
      shot.request = session.request;
      session.shots.push(shot);
      session.phase = 'result';
      render();
    });
  }

  // The brief's chips light up as she matches it, so the panel doubles as a
  // viewfinder readout — you can see you have the shot before spending it.
  let sinceRefresh = 0;
  function tick() {
    requestAnimationFrame(tick);
    if (session.phase !== 'shooting') return;
    sinceRefresh += 1;
    if (sinceRefresh < 6) return;   // ~10Hz; rebuilding the panel every frame is wasteful
    sinceRefresh = 0;
    renderShootingChips();
  }

  function renderShootingChips() {
    const chips = root.querySelectorAll('.pg-chip');
    if (chips.length !== 3) return;
    const live = api.getState();
    chips[0].dataset.ok = String(live.animName === session.request.pose);
    chips[1].dataset.ok = String(live.expression === session.request.expression
      && live.expressionWeight >= EXPRESSION_SETTLED);
    chips[2].dataset.ok = String(framingLive());
  }

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
    if (session.phase === 'shooting') shoot();
  });

  render();
  tick();

  // Test hooks. The scoring is pure and tested on its own; these drive the
  // session so a test can play a round without clicking.
  window.__game = {
    scoreShot,
    getPhase: () => session.phase,
    getRequest: () => session.request,
    getShots: () => session.shots.map((shot) => ({ score: shot.score, request: shot.request })),
    // Set the brief instead of rolling for it, so a test can ask for the shot
    // it is about to take.
    startForTest: (request) => {
      session.shots = [];
      session.request = request || makeRequest();
      session.phase = 'shooting';
      render();
    },
    shootForTest: () => new Promise((resolve) => {
      api.takePhoto((shot) => {
        shot.score = scoreShot(session.request, shot);
        shot.request = session.request;
        session.shots.push(shot);
        session.phase = 'result';
        render();
        resolve({ score: shot.score, bytes: shot.dataUrl.length });
      });
    }),
    listCastForTest: () => (api.listCast ? api.listCast() : []),
    setCharacterForTest: (key) => { api.setCharacter(key); render(); },
    getCharacterForTest: () => (api.getCharacter ? api.getCharacter() : null),
    poseForTest: api.setPose,
    expressionForTest: api.setExpression,
    measureForTest: api.measureFraming,
  };

  return {
    // The cast arrives one download at a time, so the picker has to be told
    // when there is someone new to offer. Only redrawn between sessions —
    // rebuilding the panel mid-brief would throw away the live chip states.
    castChanged() {
      if (session.phase === 'free') render();
    },
  };
}
