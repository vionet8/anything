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

// She works through these on her own during a session -- see the director in
// main.js -- so the hints are no longer keys you press; they are kept as a
// label for the brief chip and for anyone reading this file, not as UI copy.
export const POSES = [
  { key: 'peace', label: 'ピース' },
  { key: 'double-peace', label: 'ダブルピース' },
  { key: 'wave', label: '手を振る' },
  { key: 'crouch', label: 'しゃがむ' },
  { key: 'idle', label: '自然体' },
  { key: 'dance', label: 'ダンス' },
];

// How far above her head her hands have to be to count as the peak of the
// routine. Measured off the rig: the routine tops out at 0.28, and this
// threshold is met on about 8% of frames — a sixth of a second in a
// two-and-a-bit second loop, which is roughly the window a burst covers.
export const DANCE_PEAK_REACH = 0.15;

// How many frames a burst takes, player's choice. Spacing is held constant
// across the options (about 20 frames/second) rather than the total window,
// so "few" is a quick, short burst and "many" is a longer one that covers
// more time -- not the same half-second sampled at different resolutions.
export const BURST_OPTIONS = [
  { frames: 6, label: '6枚' },
  { frames: 12, label: '12枚' },
  { frames: 24, label: '24枚' },
];
const BURST_SPACING = 0.05;
const DEFAULT_BURST_FRAMES = 12;

export const EXPRESSIONS = [
  { key: 'happy', label: '笑顔' },
  { key: 'relaxed', label: 'にっこり' },
  { key: 'Surprised', label: '驚き' },
  { key: 'angry', label: '怒り' },
  { key: 'sad', label: '悲しい' },
  { key: 'Extra', label: '>_<' },
];

// How much of the frame's height her head should fill. Measured off the real
// projection rather than picked out of the air -- tools/measure_framing.js
// prints the number at a range of camera distances.
//
// A third band asking for a tight close-up used to sit here too. Getting the
// head that large in frame meant the camera at ~1.3m or closer, which is
// closer than the model reads well at -- the texture resolution and the
// toon shading are tuned for a normal portrait distance, not a beauty shot,
// and it looked wrong rather than intimate. Removed rather than patched: it
// is not a fidelity problem worth solving here, just a distance not to ask
// the player to go to.
export const FRAMINGS = [
  { key: 'medium', label: '標準', min: 0.055, max: 0.105 },  // ~2m to 3m
  { key: 'wide', label: '引き', min: 0.020, max: 0.040 },    // ~4m to 8.5m
];

// Where the light is coming from, in the angle lightAngleDegrees() reports:
// 0 is the sun behind you, 180 is shooting into it.
export const LIGHTS = [
  { key: 'front', label: '順光', min: 0, max: 55 },
  { key: 'side', label: 'サイド光', min: 55, max: 125 },
  { key: 'back', label: '逆光', min: 125, max: 180 },
];

// How bright her face should come out in the finished picture, as mean luma.
// Measured, not chosen. tools/measure_light.js reads her face at each light
// angle and compensation:
//
//            no compensation   +1 stop   +2 stops
//   順光            0.46         0.75       0.92
//   サイド光         0.44         0.68       0.91
//   半逆光          0.42         0.65       0.90
//   逆光            0.41         0.63       0.90
//
// The band is drawn so that the easy light needs nothing, shooting into the sun
// needs a stop of lift, and pushing every shot to +2 blows the face out. That
// gradient is the lesson.
export const FACE_LUMA = { min: 0.43, max: 0.72 };

const SHOTS_PER_SESSION = 3;

// What each part of the brief is worth. Scored as a fraction of what was
// available rather than as a running total, so a brief that asks for one more
// thing does not quietly move the star thresholds.
const POINTS = {
  pose: 25, expression: 25, inFrame: 10, framing: 15, centred: 10, brightness: 15, light: 15,
  moment: 25,
};
const STAR_THRESHOLDS = [85, 60, 30];   // 3 stars, 2 stars, 1 star

// An expression that has only just started easing in is not the expression she
// is wearing yet.
const EXPRESSION_SETTLED = 0.6;

const byKey = (list, key) => list.find((entry) => entry.key === key);

export function scoreShot(request, shot) {
  const framing = shot.framing;
  const band = byKey(FRAMINGS, request.framing);
  const parts = [];
  const add = (part) => parts.push({ ...part, points: part.ok ? part.max : (part.points || 0) });

  const poseOk = shot.state.animName === request.pose;
  add({
    key: 'pose', label: 'ポーズ', max: POINTS.pose, ok: poseOk,
    hint: poseOk ? null : `お題は「${byKey(POSES, request.pose).label}」でした`,
  });

  const expressionOk = shot.state.expression === request.expression
    && shot.state.expressionWeight >= EXPRESSION_SETTLED;
  add({
    key: 'expression', label: '表情', max: POINTS.expression, ok: expressionOk,
    hint: expressionOk ? null : `表情が「${byKey(EXPRESSIONS, request.expression).label}」になっていません`,
  });

  const inFrame = !!framing && !framing.behindCamera
    && Math.abs(framing.x) < 0.45 && Math.abs(framing.y) < 0.45;
  add({
    key: 'inFrame', label: '顔が写っている', max: POINTS.inFrame, ok: inFrame,
    hint: inFrame ? null : '顔がフレームから外れています',
  });

  const framingOk = inFrame && framing.faceSize >= band.min && framing.faceSize <= band.max;
  add({
    key: 'framing', label: band.label, max: POINTS.framing, ok: framingOk,
    hint: framingOk ? null
      : (!inFrame ? '顔を入れてから寄り引きを合わせましょう'
        : framing.faceSize < band.min ? `${band.label}のお題です。もっと寄ってください`
          : `${band.label}のお題です。引きすぎています`),
  });

  // Centring is the one part that is not pass/fail: dead centre scores full,
  // and it falls off to nothing at the edge of the frame. A photo can be a
  // little off-centre and still be a good photo.
  const offCentre = inFrame ? Math.hypot(framing.x, framing.y) : 1;
  const centred = Math.max(0, 1 - offCentre / 0.35);
  add({
    key: 'centred', label: '構図', max: POINTS.centred, ok: centred > 0.5, points: Math.round(POINTS.centred * centred),
    hint: centred > 0.5 ? null : '顔が画面の端に寄りすぎています',
  });

  // The photograph's own pixels, where her face is. This is the part that
  // rewards handling the light rather than pointing the camera.
  const luma = shot.faceLuma;
  const bright = luma !== null && luma !== undefined;
  const brightOk = bright && luma >= FACE_LUMA.min && luma <= FACE_LUMA.max;
  add({
    key: 'brightness', label: '顔の明るさ', max: POINTS.brightness, ok: brightOk,
    hint: brightOk ? null
      : !bright ? '顔が写っていないので明るさを測れません'
        : luma < FACE_LUMA.min
          ? '顔が暗く沈んでいます。逆光では明るさを＋に補正します'
          : '顔が明るく飛んでいます。明るさを−に戻しましょう',
  });

  // A dance brief is asking you to catch a moment, not to hold a pose, so the
  // moment is what is scored — measured off where her hands actually were in
  // the captured frame rather than off where the routine's clock says they
  // should have been.
  if (request.pose === 'dance') {
    const reachOk = shot.reach >= DANCE_PEAK_REACH;
    add({
      key: 'moment', label: '決めの瞬間', max: POINTS.moment, ok: reachOk,
      hint: reachOk ? null
        : shot.reach >= DANCE_PEAK_REACH * 0.6
          ? 'あと少し早い／遅いです。腕が伸びきった瞬間を狙いましょう'
          : '決めのポーズから外れています。連写して選ぶと当たります',
    });
  }

  if (request.light) {
    const wanted = byKey(LIGHTS, request.light);
    const angle = shot.lightAngle;
    const lightOk = angle !== undefined && angle >= wanted.min && angle <= wanted.max;
    add({
      key: 'light', label: wanted.label, max: POINTS.light, ok: lightOk,
      hint: lightOk ? null
        : `いまは${describeLight(angle)}です。${wanted.label}になる位置まで回り込みましょう`,
    });
  }

  const earned = parts.reduce((sum, part) => sum + part.points, 0);
  const possible = parts.reduce((sum, part) => sum + part.max, 0);
  const total = Math.round((earned / possible) * 100);
  const rank = STAR_THRESHOLDS.findIndex((threshold) => total >= threshold);
  let stars = rank === -1 ? 0 : 3 - rank;
  // A beautifully framed photo of the wrong pose is not a good photo. The
  // technical half alone is worth about half the points, which would otherwise
  // buy two stars for a shot that ignored the brief entirely.
  if (!(poseOk && expressionOk)) stars = Math.min(stars, 1);
  return { total, stars, parts };
}

export function describeLight(angle) {
  if (angle === undefined || angle === null) return '不明';
  return (LIGHTS.find((entry) => angle >= entry.min && angle <= entry.max) || LIGHTS[1]).label;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function makeRequest(shotNumber = 1) {
  const request = {
    pose: pick(POSES).key,
    expression: pick(EXPRESSIONS).key,
    framing: pick(FRAMINGS).key,
  };
  // The light is only asked for from the second shot on. The first one is
  // enough to be learning the controls with.
  if (shotNumber >= 2) request.light = pick(LIGHTS).key;
  return request;
}

export function describeRequest(request) {
  return {
    pose: byKey(POSES, request.pose),
    expression: byKey(EXPRESSIONS, request.expression),
    framing: byKey(FRAMINGS, request.framing),
    light: request.light ? byKey(LIGHTS, request.light) : null,
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
.pg-ev { display: flex; align-items: center; gap: 8px; margin-top: 10px;
  padding-top: 10px; border-top: 1px solid #232838; }
.pg-ev-label { font-size: 11px; color: #8b93a7; white-space: nowrap; }
.pg-ev-slider { flex: 1; min-width: 0; accent-color: #ffb454; }
.pg-ev-value { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
  min-width: 3.2em; text-align: right; }
.pg-notes { list-style: none; margin: 0 0 12px; padding: 0; text-align: left; }
.pg-notes li { font-size: 12px; line-height: 1.6; color: #ffd166; padding: 3px 0; }
.pg-notes li::before { content: "・"; }
/* Set on <body> for the length of a session. The keyboard hints for pose and
   expression live in the surrounding page (there are two of them: the dev
   page's plain HUD and the artifact's styled one), not in this file, so they
   are reached by class rather than redrawn here. */
body.pg-directed .pg-manual-hint { opacity: 0.32; }
.pg-cast { display: flex; gap: 6px; margin-top: 10px; }
.pg-burstpick { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.pg-burstpick-label { font-size: 11px; color: #8b93a7; white-space: nowrap; }
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
.pg-burst { display: flex; align-items: center; justify-content: center; }
.pg-burst-label { font-size: 12px; font-weight: 700; color: #0c0e14; letter-spacing: 0.04em; }
/* The review screen: one large preview plus a horizontally scrolling strip of
   every frame, rather than a small fixed grid -- picking the right one out of
   a burst of frames that can look nearly identical at thumbnail size needs
   room, and needs to be able to flip through them side by side. */
.pg-card-wide { width: min(560px, 100%); }
.pg-preview-wrap { position: relative; margin-bottom: 10px; }
.pg-preview { width: 100%; max-height: 46vh; display: block; margin: 0 auto;
  border-radius: 6px; border: 1px solid #2a3040; background: #0c0e14; }
.pg-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px;
  border-radius: 50%; border: 1px solid #2a3040; background: rgba(12, 14, 20, 0.75);
  color: #e8ebf2; font-size: 20px; line-height: 1; cursor: pointer; }
.pg-nav-prev { left: 8px; }
.pg-nav-next { right: 8px; }
.pg-strip { display: flex; gap: 6px; margin: 0 0 14px; padding-bottom: 2px;
  overflow-x: auto; scroll-snap-type: x proximity; }
.pg-frame { flex: 0 0 auto; width: 64px; padding: 0; border: 2px solid #2a3040; border-radius: 4px;
  background: #0c0e14; cursor: pointer; overflow: hidden; line-height: 0; scroll-snap-align: center; }
.pg-frame:hover { border-color: #ffb454; }
.pg-frame[data-on="true"] { border-color: #ffb454; }
.pg-frame canvas { width: 100%; display: block; }
.pg-pick-actions { display: flex; gap: 8px; }
.pg-pick-actions .pg-button { margin-top: 0; }
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
  const session = {
    shots: [], request: null, burst: null, phase: 'free', burstFrames: DEFAULT_BURST_FRAMES,
  };

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
    if (session.phase === 'picking') return renderPicking();
    if (session.phase === 'result') return renderResult();
    if (session.phase === 'album') return renderAlbum();
  }

  function renderFree() {
    const panel = el('div', 'pg-panel');
    panel.append(
      el('p', 'pg-label', '撮影会'),
      el('p', 'pg-count',
        `彼女は自分のペースでポーズや表情を変えていきます。お題に合う瞬間を逃さず、${SHOTS_PER_SESSION}枚撮ってください。`),
    );
    panel.append(renderCastPicker());
    panel.append(renderBurstPicker());
    const start = el('button', 'pg-button', '撮影を始める');
    start.addEventListener('click', () => {
      session.shots = [];
      placeSun();
      setDirector(true);
      nextRequest();
    });
    panel.append(start);
    root.append(panel);
  }

  // How many frames the next shutter press takes. Offered both before a
  // session starts and while shooting, since the right choice can depend on
  // the pose -- a still peace sign barely needs it, a dance benefits from more.
  function renderBurstPicker() {
    const wrap = el('div', 'pg-burstpick');
    wrap.append(el('span', 'pg-burstpick-label', '連写'));
    for (const option of BURST_OPTIONS) {
      const button = el('button', 'pg-pick', option.label);
      button.dataset.on = String(option.frames === session.burstFrames);
      button.addEventListener('click', () => {
        session.burstFrames = option.frames;
        render();
      });
      wrap.append(button);
    }
    return wrap;
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
    for (const entry of [described.pose, described.expression, described.framing, described.light]) {
      if (!entry) continue;
      const node = el('span', 'pg-chip',
        `${entry.label}${entry.hint ? `<small>${entry.hint}</small>` : ''}`);
      node.dataset.ok = 'false';
      brief.append(node);
    }
    panel.append(brief);
    panel.append(el('p', 'pg-count', `${session.shots.length + 1} / ${SHOTS_PER_SESSION} 枚目`));
    panel.append(renderExposure());
    panel.append(renderBurstPicker());
    root.append(panel);
    renderShootingChips();

    // Always a burst now, not just for the dance: she is never holding still
    // for you, so any shot can catch her a beat early or late. Burst and pick
    // is the forgiveness for that, not a special case for one pose.
    const shutter = el('button', 'pg-shutter pg-burst');
    shutter.setAttribute('aria-label', '連写');
    shutter.append(el('span', 'pg-burst-label', `${session.burstFrames}枚`));
    shutter.addEventListener('click', shootBurst);
    root.append(shutter, el('div', 'pg-flash'));
  }

  // The exposure slider. A phone puts this under your thumb for a reason: the
  // whole point is that you adjust it while looking at the subject, not in a
  // settings screen afterwards.
  function renderExposure() {
    const wrap = el('div', 'pg-ev');
    const label = el('span', 'pg-ev-label', '明るさ');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pg-ev-slider';
    slider.min = String(-(api.compensationLimit || 2));
    slider.max = String(api.compensationLimit || 2);
    slider.step = '0.25';
    slider.value = String(api.getExposure().compensation);
    slider.setAttribute('aria-label', '明るさ補正');
    const readout = el('span', 'pg-ev-value', formatStops(Number(slider.value)));
    slider.addEventListener('input', () => {
      const stops = api.setCompensation(Number(slider.value));
      readout.textContent = formatStops(stops);
    });
    // Or the keyboard would keep the slider and swallow the shutter's Enter.
    slider.addEventListener('keydown', (event) => event.stopPropagation());
    wrap.append(label, slider, readout);
    return wrap;
  }

  function formatStops(stops) {
    if (Math.abs(stops) < 0.01) return '±0';
    return `${stops > 0 ? '+' : '−'}${Math.abs(stops).toFixed(2).replace(/\.?0+$/, '')}`;
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

    // The teaching half: what went wrong and what to do about it, in the same
    // words a person would use. Only the misses — a list of things you already
    // did right is not advice.
    const misses = shot.score.parts.filter((part) => !part.ok && part.hint);
    if (misses.length) {
      const notes = el('ul', 'pg-notes');
      for (const part of misses.slice(0, 3)) notes.append(el('li', null, part.hint));
      card.append(notes);
    }
    const next = el('button', 'pg-button',
      session.shots.length >= SHOTS_PER_SESSION ? '結果を見る' : '次のお題へ');
    next.addEventListener('click', () => {
      if (session.shots.length >= SHOTS_PER_SESSION) {
        // Nothing left to catch, so give control back rather than leaving her
        // performing to nobody behind the album screen.
        setDirector(false);
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
      placeSun();
      setDirector(true);
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
    session.request = makeRequest(session.shots.length + 1);
    session.phase = 'shooting';
    // Guarantees the brief's exact pose+expression happens soon rather than
    // whenever the two independent cycles happen to coincide -- see the
    // director in main.js. Every brief gets its own countdown.
    if (api.scheduleMoment) api.scheduleMoment(session.request.pose, session.request.expression);
    render();
  }

  // Wraps api.setDirectorActive so the dev page's and the artifact's keyboard
  // hints dim in step with the director actually taking the pose/expression
  // keys away -- see the `.pg-manual-hint` rule above.
  function setDirector(on) {
    api.setDirectorActive(on);
    document.body.classList.toggle('pg-directed', on);
  }

  // A fresh sun for each session, so the same brief is a different problem
  // next time: where the light is decides which way you have to walk.
  function placeSun() {
    if (!api.setSun) return;
    // Kept low. A sun overhead is out of frame from every angle, so it lights
    // everything the same and there is nothing to walk around; a low one is
    // also when backlight is a problem in real life.
    api.setSun(Math.random() * Math.PI * 2, 0.18 + Math.random() * 0.24);
  }

  function keep(shot) {
    shot.score = scoreShot(session.request, shot);
    shot.request = session.request;
    session.shots.push(shot);
    session.phase = 'result';
    render();
  }

  // Burst, then choose. Shooting a moving subject and then picking the frame
  // that caught it is one skill in two halves, and the second half is the one
  // people skip.
  function shootBurst() {
    const flash = root.querySelector('.pg-flash');
    if (flash) flash.classList.add('pg-firing');
    api.takeBurst(session.burstFrames, (frames) => {
      session.burst = frames;
      session.pickIndex = 0;
      session.phase = 'picking';
      render();
    });
  }

  function renderPicking() {
    const sheet = el('div', 'pg-sheet');
    const card = el('div', 'pg-card pg-card-wide');
    card.append(
      el('h2', null, 'どれを残しますか'),
      el('p', null, `${session.burst.length}枚撮れました。矢印か下の一覧で見比べて、一番いい1枚を選んでください。`),
    );

    const previewWrap = el('div', 'pg-preview-wrap');
    const preview = document.createElement('canvas');
    preview.className = 'pg-preview';
    const prevButton = el('button', 'pg-nav pg-nav-prev', '‹');
    const nextButton = el('button', 'pg-nav pg-nav-next', '›');
    prevButton.setAttribute('aria-label', '前の写真');
    nextButton.setAttribute('aria-label', '次の写真');
    previewWrap.append(preview, prevButton, nextButton);
    card.append(previewWrap);

    const counter = el('p', 'pg-count', '');
    counter.style.marginBottom = '14px';
    card.append(counter);

    const strip = el('div', 'pg-strip');
    const thumbs = session.burst.map((frame, index) => {
      const button = el('button', 'pg-frame');
      // The frames are canvases, not images: encoding every one of them to
      // JPEG just to show a thumbnail would cost more than the burst did.
      button.append(frame.canvas);
      button.addEventListener('click', () => { session.pickIndex = index; syncPreview(); });
      strip.append(button);
      return button;
    });
    card.append(strip);

    // The preview is a second canvas redrawn from whichever frame is
    // selected, rather than moving that frame's own canvas element into it --
    // a canvas can only be in one place in the DOM, and the filmstrip needs
    // to keep showing it too. Blitting is a cheap GPU copy, unlike encoding.
    function syncPreview() {
      const frame = session.burst[session.pickIndex];
      preview.width = frame.canvas.width;
      preview.height = frame.canvas.height;
      preview.getContext('2d').drawImage(frame.canvas, 0, 0);
      counter.textContent = `${session.pickIndex + 1} / ${session.burst.length} 枚目`;
      thumbs.forEach((thumb, index) => { thumb.dataset.on = String(index === session.pickIndex); });
      thumbs[session.pickIndex].scrollIntoView({ inline: 'center', block: 'nearest' });
    }
    syncPreview();

    prevButton.addEventListener('click', () => {
      session.pickIndex = (session.pickIndex - 1 + session.burst.length) % session.burst.length;
      syncPreview();
    });
    nextButton.addEventListener('click', () => {
      session.pickIndex = (session.pickIndex + 1) % session.burst.length;
      syncPreview();
    });

    const actions = el('div', 'pg-pick-actions');
    const useThis = el('button', 'pg-button pg-use', 'この写真にする');
    useThis.addEventListener('click', () => {
      const frame = session.burst[session.pickIndex];
      session.burst = null;
      session.pickIndex = null;
      keep(api.encodeFrame(frame));
    });
    // None of the frames caught it: go back and shoot again rather than being
    // forced to keep a bad one. Does not consume a shot -- the counter and
    // the brief are unchanged, only the burst is thrown away.
    const retake = el('button', 'pg-button pg-ghost', '撮り直す');
    retake.addEventListener('click', () => {
      session.burst = null;
      session.pickIndex = null;
      session.phase = 'shooting';
      render();
    });
    actions.append(useThis, retake);
    card.append(actions);

    sheet.append(card);
    root.append(sheet);
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
    if (chips.length < 3) return;
    const live = api.getState();
    chips[0].dataset.ok = String(live.animName === session.request.pose);
    chips[1].dataset.ok = String(live.expression === session.request.expression
      && live.expressionWeight >= EXPRESSION_SETTLED);
    chips[2].dataset.ok = String(framingLive());
    if (chips[3] && session.request.light) {
      const wanted = byKey(LIGHTS, session.request.light);
      const angle = api.lightAngle();
      chips[3].dataset.ok = String(angle >= wanted.min && angle <= wanted.max);
    }
  }

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
    if (session.phase === 'shooting') shootBurst();
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
        resolve({
          score: shot.score,
          bytes: shot.dataUrl.length,
          faceLuma: shot.faceLuma,
          lightAngle: shot.lightAngle,
          exposure: shot.exposure,
        });
      });
    }),
    reachForTest: () => api.danceReach(),
    setDirectorForTest: (on) => setDirector(on),
    burstForTest: () => new Promise((resolve) => {
      api.takeBurst(session.burstFrames, (frames) => {
        session.burst = frames;
        session.pickIndex = 0;
        session.phase = 'picking';
        render();
        resolve(frames.map((frame, index) => ({ index, reach: frame.reach })));
      });
    }),
    pickForTest: (index) => {
      const frame = session.burst[index];
      session.burst = null;
      keep(api.encodeFrame(frame));
      return { score: frame.score, reach: frame.reach };
    },
    setSunForTest: (azimuth, elevation) => api.setSun(azimuth, elevation),
    lightAngleForTest: () => api.lightAngle(),
    getExposureForTest: () => api.getExposure(),
    setCompensationForTest: (stops) => api.setCompensation(stops),
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
