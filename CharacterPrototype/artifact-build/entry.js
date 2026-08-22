import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { initPhotoGame } from '../src/game.js';

const canvas = document.getElementById('scene');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd9e8, 28, 75);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Linear rather than filmic: it is a plain multiply and a clamp, so at
// exposure 1.0 the picture is pixel-for-pixel what it was before exposure
// existed, and the highlights clip the way a phone's do when you push them.
renderer.toneMapping = THREE.LinearToneMapping;

// ---- Sky (gradient sphere, no external HDRI needed) ----
const skyGeo = new THREE.SphereGeometry(200, 24, 16);
const skyColors = [];
const skyPos = skyGeo.attributes.position;
const topColor = new THREE.Color(0x4a90d9);
const horizonColor = new THREE.Color(0xcfe8f2);
for (let i = 0; i < skyPos.count; i++) {
  const y = skyPos.getY(i) / 200;
  const t = THREE.MathUtils.clamp(y * 0.9 + 0.15, 0, 1);
  const c = horizonColor.clone().lerp(topColor, t);
  skyColors.push(c.r, c.g, c.b);
}
skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
scene.add(sky);

// ---- Lighting ----
// The ambient fill used to be strong enough (1.15) that the sun barely
// mattered: her face read the same brightness whichever way the light came
// from, which is a pleasant look and a useless one for a game about handling
// light. Dropped to a fill that fills, with the sun doing the lighting.
const hemi = new THREE.HemisphereLight(0xdff0ff, 0x6b8f5a, 0.5);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff3d6, 2.6);
sun.position.set(10, 18, 6);

// Where the sun is, as an angle rather than a position, so the game can put it
// behind her and make you deal with it. Elevation is kept fairly low: a sun
// overhead lights everyone the same and there is nothing to photograph around.
const SUN_DISTANCE = 26;
let sunAzimuth = Math.atan2(sun.position.x, sun.position.z);
let sunElevation = 0.62;

// The sun as something you can see and shoot into, not just a light. Without
// it, turning to face the sun changes nothing in frame, the meter reads the
// same average, and backlight costs nothing — which is the opposite of the
// problem this game is about.
// Sized against the meter rather than by eye. A small bright disc looks like a
// sun and does nothing: at 170m even a 6-unit circle is two degrees across, a
// rounding error in a 50-degree frame, so pointing the camera at it moved the
// exposure not at all. What actually makes a backlit shot hard is the haze
// around the sun washing out a third of the picture, so that is what this is.
// A flat disc for the glow read as a giant pale coin stuck on the sky, facets
// and all. Haze has no edge, so it is painted as a radial falloff instead.
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,250,235,0.95)');
  gradient.addColorStop(0.25, 'rgba(255,244,214,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,240,205,0.18)');
  gradient.addColorStop(1, 'rgba(255,238,200,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(9, 32),
  new THREE.MeshBasicMaterial({ color: 0xfffdf2, fog: false })
);
const sunGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(150, 150),
  new THREE.MeshBasicMaterial({
    map: makeGlowTexture(), transparent: true, depthWrite: false, fog: false,
  })
);
scene.add(sunDisc, sunGlow);

function setSun(azimuth, elevation = sunElevation) {
  sunAzimuth = azimuth;
  sunElevation = elevation;
  const ground = Math.cos(elevation) * SUN_DISTANCE;
  sun.position.set(
    Math.sin(azimuth) * ground,
    Math.sin(elevation) * SUN_DISTANCE,
    Math.cos(azimuth) * ground
  );
  // Out on the sky sphere, so it sits behind everything and reads as sky
  // rather than as an object in the scene.
  const far = 170;
  for (const disc of [sunDisc, sunGlow]) {
    disc.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * far,
      Math.sin(elevation) * far,
      Math.cos(azimuth) * Math.cos(elevation) * far
    );
  }
}
setSun(sunAzimuth, sunElevation);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

// ---- Ground ----
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(60, 48),
  new THREE.MeshStandardMaterial({ color: 0x6fa15a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const pathMat = new THREE.MeshStandardMaterial({ color: 0xcbb994, roughness: 1 });
const path = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 40), pathMat);
path.rotation.x = -Math.PI / 2;
path.position.set(0, 0.01, 12);
path.receiveShadow = true;
scene.add(path);

// ---- Simple procedural scenery: trees + rolling hills, deterministic so ----
// the scene layout doesn't shuffle between reloads.
function makeTree(x, z, scale) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 1 })
  );
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  group.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1 - i * 0.22, 1.4, 8), leafMat);
    leaf.position.y = 1.6 + i * 0.9;
    leaf.castShadow = true;
    group.add(leaf);
  }
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  return group;
}

let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

for (let i = 0; i < 26; i++) {
  const angle = rand() * Math.PI * 2;
  const radius = 14 + rand() * 32;
  const x = Math.sin(angle) * radius;
  const z = Math.cos(angle) * radius;
  if (Math.abs(x) < 2.2 && z > -2 && z < 42) continue; // keep the path clear
  scene.add(makeTree(x, z, 0.85 + rand() * 0.5));
}

const hillMat = new THREE.MeshStandardMaterial({ color: 0x5c8f52, roughness: 1 });
for (let i = 0; i < 10; i++) {
  const angle = (i / 10) * Math.PI * 2;
  const radius = 48 + rand() * 10;
  const hill = new THREE.Mesh(new THREE.SphereGeometry(8 + rand() * 6, 12, 8), hillMat);
  hill.position.set(Math.sin(angle) * radius, -6, Math.cos(angle) * radius);
  scene.add(hill);
}

// ---- Bird ----
// A visiting bird, built once and re-used for every visit. What it does and
// why is down with the scenarios that send it -- see birdCue / updateBird.
// One flat triangle, reused for both wings (mirrored) and the tail.
function makeWingGeometry() {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0, 0, 0,
    0.11, -0.01, -0.03,
    0.05, 0.005, -0.09,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeBird() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.75 });
  const breastMat = new THREE.MeshStandardMaterial({ color: 0xe8a24a, roughness: 0.8 });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.6 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x3a5a8a, roughness: 0.75, side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bodyMat);
  body.scale.set(1, 0.88, 1.55);
  group.add(body);

  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), breastMat);
  breast.position.set(0, -0.012, 0.03);
  breast.scale.set(0.9, 0.85, 0.9);
  group.add(breast);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.028, 7, 6), bodyMat);
  head.position.set(0, 0.022, 0.065);
  group.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 5), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.02, 0.09);
  group.add(beak);

  const leftWing = new THREE.Mesh(makeWingGeometry(), wingMat);
  leftWing.position.set(0.02, 0.012, 0);
  const rightWing = new THREE.Mesh(makeWingGeometry(), wingMat);
  rightWing.position.set(-0.02, 0.012, 0);
  rightWing.scale.x = -1;
  group.add(leftWing, rightWing);

  const tail = new THREE.Mesh(makeWingGeometry(), wingMat);
  tail.position.set(0, 0, -0.06);
  tail.rotation.y = Math.PI / 2;
  tail.scale.setScalar(0.85);
  group.add(tail);

  group.userData.leftWing = leftWing;
  group.userData.rightWing = rightWing;
  group.visible = false;
  group.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });
  return group;
}

const bird = makeBird();
scene.add(bird);

// ---- Character (VRM) ----
const MOVE_SPEED = 3.2;
const RUN_SPEED = 6.6;
// Solved from a target arc rather than picked by feel: a ~0.47s hop that
// peaks just under a third of her standing height (0.49 units) reads as a
// quick, game-y jump instead of a slow, floaty one.
const JUMP_GRAVITY = 18;
const JUMP_VELOCITY = 4.2;
const LANDING_RECOVER_TIME = 0.18;

const state = {
  ready: false,
  animName: 'idle',
  position: new THREE.Vector3(0, 0, 0),
  heading: 0,
};

const keys = {
  forward: false, back: false, left: false, right: false, run: false,
  wave: false, crouch: false, peace: false, doublePeace: false, dance: false,
  // Story poses, driven by the director rather than by the keyboard.
  reachOut: false, crouchLook: false, lookUp: false,
};

// Jump is a one-shot trigger (a single keydown), not a held state like the
// others, so it lives outside `keys` and is driven by startJump() directly.
let airborne = false;
let velocityY = 0;
let landingRecoverT = 0;

function startJump() {
  if (airborne || landingRecoverT > 0) return; // no double-jump, no jump-cancel out of landing
  airborne = true;
  velocityY = JUMP_VELOCITY;
}

// Held expression keys on the number row. Ordered by how often you'd reach
// for one rather than by the model's own ordering. 'Surprised' and 'Extra'
// are this model's two non-preset expressions — Extra draws a >_< over the
// eyes — so they are addressed by their exact authored names, and setValue
// ignores a name the model does not have.
const FACE_KEYS = {
  Digit1: 'happy',
  Digit2: 'relaxed',
  Digit3: 'Surprised',
  Digit4: 'angry',
  Digit5: 'sad',
  Digit6: 'Extra',
};
let heldExpression = null;

// While the director is running the show (during a photo session), pose and
// expression keys are hers, not yours -- the whole point is that you cannot
// order up the moment, only wait for it. Movement, the camera and the shutter
// stay live throughout; only the puppet strings are cut.
let directorActive = false;

function onKey(e, down) {
  const expression = FACE_KEYS[e.code];
  if (expression) {
    if (directorActive) return;
    // Only clear on the release of the key that set it, so rolling from one
    // expression key to the next doesn't blank the face when the first lifts.
    if (down) heldExpression = expression;
    else if (heldExpression === expression) heldExpression = null;
    return;
  }

  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = down;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.back = down;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = down;
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.right = down;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.run = down;
      break;
    case 'KeyE':
      if (!directorActive) keys.wave = down;
      break;
    case 'KeyC':
      if (!directorActive) keys.crouch = down;
      break;
    case 'KeyV':
      if (!directorActive) keys.peace = down;
      break;
    case 'KeyB':
      if (!directorActive) keys.doublePeace = down;
      break;
    case 'KeyR':
      if (!directorActive) keys.dance = down;
      break;
    // The story poses. They exist for the scenarios, but there is no reason
    // to keep them off the keyboard in free play.
    case 'KeyF':
      if (!directorActive) keys.reachOut = down;
      break;
    case 'KeyG':
      if (!directorActive) keys.crouchLook = down;
      break;
    case 'KeyT':
      if (!directorActive) keys.lookUp = down;
      break;
    case 'Space':
      e.preventDefault(); // stop the page from scrolling on spacebar
      if (down) startJump();
      break;
  }
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));

const touchPad = document.getElementById('touch-pad');
if (touchPad) {
  const setTouch = (on) => { keys.forward = on; };
  touchPad.addEventListener('touchstart', (e) => { e.preventDefault(); setTouch(true); }, { passive: false });
  touchPad.addEventListener('touchend', (e) => { e.preventDefault(); setTouch(false); }, { passive: false });
  touchPad.addEventListener('touchcancel', () => setTouch(false));
}

// ---- Director ----
// During a photo session she runs her own routine rather than waiting on
// keys: the player's job moves entirely to the camera -- watch, frame, and
// catch it -- which is also the one thing a touchscreen with no keyboard
// could never do through key-driven poses in the first place.
//
// What she runs is a *scenario*, not a shuffle. The first version of this
// drew a pose and an expression out of two independent bags on two
// independent clocks, and it was wrong in three separate ways at once:
//
//   - It produced pairs nothing could motivate. A double peace sign worn
//     with a sad face is not a moment; it is two dice landing.
//   - It cut between poses with no reason, so a squat arrived out of nowhere
//     in the middle of a photoshoot.
//   - It could not be anticipated. A burst fired on a hunch missed, because
//     there was no hunch to have -- the next beat was a coin flip, and the
//     player was left counting turns waiting for the brief to come up.
//
// A scenario fixes all three by being a little story with a cause in it. The
// bird flies in, so she looks up; it comes to her hand, so she holds one out;
// it lands, so she is delighted; it leaves, so she watches it go. Each beat
// is the reason for the next, the peak of the story is the shot the brief
// asks for, and the beats before the peak are the telegraph that lets you
// know when to hold the shutter down.
const randRange = (min, max) => min + Math.random() * (max - min);

function setPoseKeys(name) {
  keys.wave = name === 'wave';
  keys.crouch = name === 'crouch';
  keys.peace = name === 'peace';
  keys.doublePeace = name === 'double-peace';
  keys.dance = name === 'dance';
  keys.reachOut = name === 'reach-out';
  keys.crouchLook = name === 'crouch-look';
  keys.lookUp = name === 'look-up';
}

// A function rather than a constant: DANCE_BEAT and DANCE_BARS are defined
// further down, alongside the routine itself, and this only ever runs after
// the whole module has loaded -- but it would be a temporal-dead-zone crash
// to reference them from a const initialised up here. A dance beat is held
// long enough to loop the routine twice, since the whole point of that one is
// repeated shots at a peak that lasts a fraction of a second.
function danceBeatHold() {
  return [DANCE_BEAT * DANCE_BARS * 1.9, DANCE_BEAT * DANCE_BARS * 2.7];
}

// ---- Scenarios ----
// A beat is a pose, a face, and how long she stays there. `cue` fires at the
// start of the beat and is what makes the *next* beat make sense -- the bird
// is sent to her hand on the beat where she reaches out, so that it lands
// just as the delight beat begins. `peak: true` marks the beat a brief is
// generated from: the photograph the story exists to produce.
//
// Holds are ranges rather than fixed numbers so the same story does not play
// back beat-for-beat identically; the order never changes, only the timing,
// which is the part that keeps anticipating it a skill rather than a
// stopwatch.
const SCENARIOS = [
  {
    key: 'bird-to-hand',
    beats: [
      { pose: 'look-up', expression: 'Surprised', hold: [1.2, 1.8], cue: { bird: 'sky', travel: 1.0 } },
      { pose: 'reach-out', expression: 'relaxed', hold: [1.5, 2.0], cue: { bird: 'hand', travel: 1.6 } },
      { pose: 'reach-out', expression: 'happy', hold: [2.8, 3.6], peak: true, story: '手にとまった鳥に、うれしそうな顔' },
      { pose: 'reach-out', expression: 'Surprised', hold: [0.9, 1.2], cue: { bird: 'away' } },
      { pose: 'look-up', expression: 'sad', hold: [1.8, 2.4] },
      { pose: 'idle', expression: null, hold: [1.2, 1.8] },
    ],
  },
  {
    key: 'bird-to-shoulder',
    beats: [
      { pose: 'idle', expression: 'relaxed', hold: [1.3, 1.8], cue: { bird: 'shoulder', travel: 1.7 } },
      { pose: 'idle', expression: 'Surprised', hold: [2.4, 3.0], peak: true, story: '肩に鳥がとまって、びっくりした顔' },
      { pose: 'peace', expression: 'happy', hold: [2.4, 3.2] },
      { pose: 'idle', expression: 'relaxed', hold: [0.9, 1.2], cue: { bird: 'away' } },
      { pose: 'look-up', expression: 'sad', hold: [1.7, 2.3] },
      { pose: 'idle', expression: null, hold: [1.2, 1.8] },
    ],
  },
  {
    key: 'bird-on-the-ground',
    beats: [
      { pose: 'idle', expression: 'Surprised', hold: [1.2, 1.7], cue: { bird: 'ground', travel: 1.4 } },
      { pose: 'crouch-look', expression: 'relaxed', hold: [1.5, 2.0] },
      { pose: 'crouch-look', expression: 'happy', hold: [2.8, 3.6], peak: true, story: 'しゃがんで鳥をのぞきこむ、うれしそうな顔' },
      { pose: 'crouch-look', expression: 'Surprised', hold: [0.8, 1.1], cue: { bird: 'away' } },
      { pose: 'look-up', expression: 'sad', hold: [1.6, 2.2] },
      { pose: 'idle', expression: null, hold: [1.2, 1.8] },
    ],
  },
  {
    key: 'noticing-you',
    beats: [
      { pose: 'idle', expression: null, hold: [1.1, 1.6] },
      { pose: 'look-up', expression: 'Surprised', hold: [1.0, 1.4] },
      { pose: 'wave', expression: 'happy', hold: [2.6, 3.4], peak: true, story: 'こちらに気づいて、手を振る' },
      { pose: 'peace', expression: 'relaxed', hold: [1.8, 2.4] },
      { pose: 'idle', expression: null, hold: [1.2, 1.6] },
    ],
  },
  {
    key: 'posing-for-you',
    beats: [
      { pose: 'idle', expression: 'relaxed', hold: [1.1, 1.5] },
      { pose: 'wave', expression: 'happy', hold: [1.8, 2.4] },
      { pose: 'peace', expression: 'happy', hold: [2.8, 3.6], peak: true, story: 'カメラに向かって、笑顔でピース' },
      { pose: 'idle', expression: 'relaxed', hold: [1.3, 1.8] },
    ],
  },
  {
    key: 'getting-into-it',
    beats: [
      { pose: 'idle', expression: 'relaxed', hold: [1.1, 1.5] },
      { pose: 'peace', expression: 'relaxed', hold: [1.6, 2.2] },
      { pose: 'double-peace', expression: 'happy', hold: [2.8, 3.6], peak: true, story: 'ノってきて、ダブルピース' },
      { pose: 'wave', expression: 'relaxed', hold: [1.5, 2.0] },
      { pose: 'idle', expression: null, hold: [1.2, 1.6] },
    ],
  },
  {
    key: 'a-quiet-one',
    beats: [
      { pose: 'idle', expression: null, hold: [1.1, 1.5] },
      { pose: 'look-up', expression: 'relaxed', hold: [1.5, 2.0] },
      { pose: 'peace', expression: 'relaxed', hold: [2.6, 3.4], peak: true, story: '落ち着いた、小さめのピース' },
      { pose: 'idle', expression: null, hold: [1.3, 1.8] },
    ],
  },
  {
    key: 'the-routine',
    beats: [
      { pose: 'idle', expression: 'relaxed', hold: [1.2, 1.7] },
      { pose: 'dance', expression: 'relaxed', hold: [1.6, 2.2] },
      { pose: 'dance', expression: 'happy', hold: danceBeatHold, peak: true, story: 'ダンスのいちばん高いところ' },
      { pose: 'idle', expression: 'Surprised', hold: [1.0, 1.4] },
      { pose: 'wave', expression: 'relaxed', hold: [1.6, 2.2] },
      { pose: 'idle', expression: null, hold: [1.2, 1.6] },
    ],
  },
  {
    key: 'kept-waiting',
    beats: [
      { pose: 'idle', expression: 'relaxed', hold: [1.2, 1.6] },
      { pose: 'look-up', expression: 'relaxed', hold: [1.4, 1.9] },
      { pose: 'idle', expression: 'angry', hold: [2.6, 3.4], peak: true, story: '待たされて、ちょっとむくれた顔' },
      { pose: 'wave', expression: 'happy', hold: [1.8, 2.4] },
      { pose: 'idle', expression: null, hold: [1.2, 1.6] },
    ],
  },
  {
    key: 'a-thought',
    beats: [
      { pose: 'idle', expression: 'relaxed', hold: [1.2, 1.6] },
      { pose: 'look-up', expression: 'sad', hold: [2.6, 3.4], peak: true, story: 'ふと空を見上げて、さみしそうな顔' },
      { pose: 'idle', expression: 'relaxed', hold: [1.4, 1.9] },
      { pose: 'peace', expression: 'happy', hold: [1.8, 2.4] },
    ],
  },
];

const scenarioByKey = (key) => SCENARIOS.find((entry) => entry.key === key);
const peakBeat = (scenario) => scenario.beats.find((beat) => beat.peak) || scenario.beats[0];

// Every pose and expression a brief can legitimately ask for is, by
// construction, one that some scenario's peak actually produces. Exported to
// the photo game so the brief is generated from the story rather than from a
// list that happens to sit next to it.
function scenarioPeaks() {
  return SCENARIOS.map((scenario) => {
    const beat = peakBeat(scenario);
    return { key: scenario.key, pose: beat.pose, expression: beat.expression, story: beat.story };
  });
}

// A shuffle bag over the scenarios, not over the poses. Plain randomness can
// string together an unlucky run and show the same story three times in a
// session of three; a bag guarantees every story turns up within one pass, so
// there is a hard bound on the repeat -- the same trick a lot of
// falling-block games use to keep the piece you need from disappearing.
function makeShuffleBag(items) {
  let deck = [];
  let last = null;
  const refill = () => {
    deck = items.slice();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  };
  return {
    next() {
      if (deck.length === 0) refill();
      // Swap away an immediate repeat of what she just did, when there is
      // something to swap with.
      if (deck.length > 1 && deck[deck.length - 1] === last) {
        [deck[deck.length - 1], deck[deck.length - 2]] = [deck[deck.length - 2], deck[deck.length - 1]];
      }
      last = deck.pop();
      return last;
    },
    // Records a draw the caller made itself, so an explicitly chosen story
    // does not then come straight back out of the bag as the next one.
    note(item) { last = item; },
  };
}

let scenarioBag = null;
let currentScenario = null;
let beatIndex = 0;
let beatTimer = 0;

// ---- The bird ----
// The bird is the story's cause, not a decoration on top of one. Where it
// goes is an anchor on her body (or on the ground in front of her), read live
// every frame -- a fixed offset would plant it in mid-air the instant an arm
// moves, and the arm moving is the entire point of the reach-out beat.
const BIRD_DEPART_TIME = 0.9;
const BIRD_CIRCLE_TIME = 1.4;

let birdState = 'offstage';   // 'offstage' | 'flying' | 'settled'
let birdAnchor = null;        // name of the anchor it is heading for / sitting on
let birdTravel = 1.2;
let birdT = 0;
const birdFrom = new THREE.Vector3();
const birdFixed = new THREE.Vector3();
let birdFlap = 0;

function bodyAnchor(boneName, outward, lift, forward = 0) {
  const node = vrm && vrm.humanoid ? vrm.humanoid.getRawBoneNode(boneName) : null;
  if (!node) return null;
  node.updateWorldMatrix(true, false);
  const base = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(node.matrixWorld);
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).normalize();
  return base
    .addScaledVector(side, outward)
    .add(new THREE.Vector3(0, lift, forward));
}

const BIRD_ANCHORS = {
  shoulder: () => bodyAnchor('rightShoulder', 0.1, 0.05, 0.01),
  // On the back of the hand rather than at its origin, so it reads as perched
  // on her rather than growing out of her wrist.
  hand: () => bodyAnchor('rightHand', 0.02, 0.035, 0.03),
  ground: () => {
    if (!vrm) return null;
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);
    return vrm.scene.position.clone().addScaledVector(forward, 0.55).setY(0.045);
  },
  // Not a perch: somewhere above and to one side, for the beat where she has
  // noticed it but it has not come down yet.
  sky: () => {
    if (!vrm) return null;
    return vrm.scene.position.clone().add(birdFixed);
  },
};

function birdAnchorPoint(name) {
  const fn = BIRD_ANCHORS[name];
  return fn ? fn() : null;
}

// Somewhere off-stage to enter from, or to leave towards: a random bearing at
// a distance, so the same story does not always play out on the same side.
function birdOffstage() {
  const angle = Math.random() * Math.PI * 2;
  const base = vrm ? vrm.scene.position : new THREE.Vector3();
  return new THREE.Vector3(
    base.x + Math.sin(angle) * 2.6,
    base.y + 1.9 + Math.random() * 0.6,
    base.z + Math.cos(angle) * 2.6
  );
}

function birdGoTo(anchor, travel) {
  const target = birdAnchorPoint(anchor);
  if (!target) return;
  if (birdState === 'offstage') {
    birdFrom.copy(birdOffstage());
    bird.visible = true;
  } else {
    birdFrom.copy(bird.position);
  }
  birdAnchor = anchor;
  birdTravel = Math.max(0.2, travel);
  birdT = 0;
  birdState = 'flying';
}

function birdLeave() {
  if (birdState === 'offstage') return;
  birdFrom.copy(bird.position);
  birdFixed.copy(birdOffstage()).setY(birdFrom.y + 2.2);
  birdAnchor = null;
  birdTravel = BIRD_DEPART_TIME;
  birdT = 0;
  birdState = 'flying';
}

function birdCue(cue) {
  if (!cue) return;
  if (cue.bird === 'away') { birdLeave(); return; }
  if (cue.bird === 'sky') {
    // A perch point has to be recomputed every frame; a patch of sky does
    // not, so it is picked once here and held in birdFixed as an offset from
    // her, which keeps it stable if she walks.
    const angle = Math.random() * Math.PI * 2;
    birdFixed.set(Math.sin(angle) * 1.5, 2.1, Math.cos(angle) * 1.5);
  }
  birdGoTo(cue.bird, cue.travel || BIRD_CIRCLE_TIME);
}

function birdReset() {
  birdState = 'offstage';
  birdAnchor = null;
  bird.visible = false;
}

function updateBird(dt) {
  if (birdState === 'offstage') return;
  birdFlap += dt * 16;
  const flap = Math.sin(birdFlap) * (birdState === 'settled' ? 0.22 : 1);
  bird.userData.leftWing.rotation.z = flap * 0.85;
  bird.userData.rightWing.rotation.z = -flap * 0.85;

  // Leaving is the one flight with no anchor to track -- everything else
  // homes on a point that moves with her.
  const departing = birdState === 'flying' && birdAnchor === null;
  const target = departing ? birdFixed : birdAnchorPoint(birdAnchor);
  if (!target) { birdReset(); return; }

  if (birdState === 'flying') {
    birdT += dt / birdTravel;
    const t = Math.min(1, birdT);
    if (departing) {
      bird.position.lerpVectors(birdFrom, target, t * t);   // accelerating away
      bird.lookAt(target);
      if (t >= 1) birdReset();
      return;
    }
    const eased = 1 - (1 - t) ** 3;                          // decelerating in
    bird.position.lerpVectors(birdFrom, target, eased);
    bird.position.y += Math.sin(t * Math.PI) * 0.22;         // a little arc on the way
    bird.lookAt(target.x, bird.position.y, target.z);
    if (t >= 1) { birdState = 'settled'; birdT = 0; }
    return;
  }

  bird.position.copy(target);
  bird.position.y += Math.sin(performance.now() * 0.004) * 0.006;  // idle bob
  // Sitting on her, it looks at whatever she is looking at; hovering in the
  // sky, it faces her.
  if (birdAnchor === 'sky' && vrm) bird.lookAt(vrm.scene.position.x, target.y - 0.6, vrm.scene.position.z);
  else bird.lookAt(target.x, target.y - 0.3, target.z + 0.6);
}

// ---- Running a scenario ----
function beatHold(beat) {
  const range = typeof beat.hold === 'function' ? beat.hold() : beat.hold;
  return randRange(range[0], range[1]);
}

function enterBeat(index) {
  beatIndex = index;
  const beat = currentScenario.beats[index];
  setPoseKeys(beat.pose);
  heldExpression = beat.expression;
  beatTimer = beatHold(beat);
  birdCue(beat.cue);
}

// Starts a specific story, or the next one out of the bag. Returns its peak
// so the photo game can write the brief from the shot the story is going to
// produce -- which is what stops a brief asking for a double peace sign with
// a sad face, and what makes firing a burst on a hunch a real skill rather
// than a bet against a random number.
function startScenario(key) {
  if (!scenarioBag) scenarioBag = makeShuffleBag(SCENARIOS.map((entry) => entry.key));
  const chosen = (key && scenarioByKey(key)) || scenarioByKey(scenarioBag.next());
  if (key) scenarioBag.note(chosen.key);
  currentScenario = chosen;
  birdReset();
  enterBeat(0);
  const beat = peakBeat(chosen);
  return { key: chosen.key, pose: beat.pose, expression: beat.expression, story: beat.story };
}

function startDirector() {
  directorActive = true;
  scenarioBag = makeShuffleBag(SCENARIOS.map((entry) => entry.key));
  startScenario();
}

function stopDirector() {
  directorActive = false;
  currentScenario = null;
  setPoseKeys('idle');
  heldExpression = null;
  birdReset();
}

function runDirector(dt) {
  if (!currentScenario) startScenario();
  beatTimer -= dt;
  if (beatTimer <= 0) {
    const next = beatIndex + 1;
    // One story runs straight into the next rather than parking her in an
    // idle pose between them; she is meant to be doing something whenever
    // the player looks up from the results screen.
    if (next >= currentScenario.beats.length) startScenario();
    else enterBeat(next);
  }
  updateBird(dt);
}

const stateLabel = document.getElementById('state-label');
const loadingEl = document.getElementById('loading');

function setAnimName(name) {
  if (state.animName === name) return;
  state.animName = name;
  notePoseChange(name);
  if (stateLabel) {
    stateLabel.textContent = name;
    stateLabel.dataset.state = name;
  }
}

let vrm = null;
let bones = {};
let hipsBaseY = 0;
// VRM 0.x models are authored facing +Z where VRM 1.0 faces -Z, and
// VRMUtils.rotateVRM0 corrects that by parking a half-turn on the scene root.
// Every place that steers the character has to add that half-turn back on,
// because assigning scene.rotation.y from a heading would otherwise wipe it
// out and leave her walking backwards.
let modelYaw = 0;
// The same half-turn also mirrors the normalized rig the pose code writes to:
// on a VRM 0.x rig the left arm rests along -X instead of +X, so a rotation
// that lowered an arm on the old VRM 1.0 model raises it here. Measured, not
// assumed — with every other bone identical, z=-1.3 on the upper arm puts the
// hand at y=0.768 on the old model and y=1.655 on this one.
let rigIsMirrored = false;

// ---- Secondary motion (spring bones) ----
// The model ships tuned for a VRoid viewer, where the avatar mostly stands
// still. Under a character who walks, runs and jumps, two of the groups read
// as over-energetic, and the numbers say why: the bust joints carry
// dragForce 0.05, which is almost no damping at all, so every footfall feeds
// a swing that never settles. In three-vrm's Verlet step, dragForce is the
// fraction of inertia thrown away each frame, so raising it is what makes the
// motion die down instead of building up.
//
// Adjusted per group by bone name, not globally: the skirt and the jacket
// panels read fine as they are, and flattening everything would take the life
// out of the model. Values live here rather than being baked into the .vrm so
// they stay next to the animation they have to sit alongside.
const SPRING_TUNING = [
  { match: /Bust/, dragForce: 0.80, stiffness: 1.3 },
  { match: /^HairJoint/, dragForce: 0.78 },
];

function calmSpringBones(target) {
  if (!target || !target.springBoneManager) return 0;
  let adjusted = 0;
  for (const joint of target.springBoneManager.joints) {
    const rule = SPRING_TUNING.find((entry) => entry.match.test(joint.bone.name));
    if (!rule) continue;
    if (rule.dragForce !== undefined) joint.settings.dragForce = rule.dragForce;
    if (rule.stiffness !== undefined) joint.settings.stiffness = rule.stiffness;
    adjusted++;
  }
  return adjusted;
}

// three.js loads a GLB's embedded textures by wrapping each one in a Blob,
// minting a blob: URL for it and fetching that URL. The published artifact runs
// under a strict Content-Security-Policy that refuses the connection, and
// GLTFLoader's image path ends in `.catch(() => null)` — so the failure is
// silent and every material falls back to untextured white. It looks like the
// model loaded fine and lost all its colour, which is exactly what it did.
//
// Decoding straight from the Blob avoids the whole question: createImageBitmap
// given a Blob object loads no URL, so no CSP directive is involved. The decode
// options mirror three's own ImageBitmapLoader so the pixels are identical to
// what the rest of the loader expects.
function cspSafeTextures(parser) {
  const proto = Object.getPrototypeOf(parser);
  if (!proto.__cspSafeTextures && typeof createImageBitmap !== 'undefined') {
    proto.__cspSafeTextures = true;
    const original = proto.loadImageSource;

    proto.loadImageSource = function (sourceIndex, imageLoader) {
      const sourceDef = this.json.images[sourceIndex];
      // Images referenced by URI still go the normal route; only the embedded
      // ones need rescuing.
      if (sourceDef.bufferView === undefined) {
        return original.call(this, sourceIndex, imageLoader);
      }
      if (this.sourceCache[sourceIndex] !== undefined) {
        return this.sourceCache[sourceIndex].then((texture) => texture.clone());
      }

      const promise = this.getDependency('bufferView', sourceDef.bufferView)
        .then((bufferView) => createImageBitmap(
          new Blob([bufferView], { type: sourceDef.mimeType }),
          { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }
        ))
        .then((bitmap) => {
          const texture = new THREE.Texture(bitmap);
          texture.needsUpdate = true;
          return texture;
        });

      this.sourceCache[sourceIndex] = promise;
      return promise;
    };
  }
  return { name: 'CSPSafeTextures' };
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const loader = new GLTFLoader();
loader.register(cspSafeTextures);
loader.register((parser) => new VRMLoaderPlugin(parser));

// The cast, in the order the picker offers them. All three are VRoid's own
// sample avatars and share one skeleton, which is why every pose in this file
// works on all of them without a per-character variant.
const CHARACTER_SOURCES = [
  { key: 'b', label: 'B', url: 'assets/char-b.vrm' },
];

// Loaded characters, keyed the same way. Only one is in the scene at a time.
const cast = [];
let activeCharacter = null;
let photoGame = null;

function loadCharacter(source) {
  return new Promise((resolve, reject) => {
    loader.parse(base64ToArrayBuffer(window.__MODEL_BASE64__), '',
      (gltf) => resolve(setUpCharacter(gltf, source)), reject);
  });
}

// How dark her shadow side is allowed to go, and how sharply it arrives.
// VRoid ships MToon set for even, flattering light from any direction: with the
// stock values her face measures the same brightness whether the sun is behind
// the camera or behind her (0.762 against 0.772, measured with the exposure
// frozen). That is what toon shading is for, and it is also a game about light
// with no light in it, so the shade term is pulled back into play.
const SHADE_DARKEN = 0.62;      // multiplier on the shade colour
const SHADE_SHIFT = -0.32;      // where the lit/shade boundary sits, -1..1
const SHADE_TOONY = 0.3;        // how hard the boundary is, 0..1

function deepenToonShading(material) {
  if (!material || !material.isMToonMaterial) return;
  if (material.shadeColorFactor) material.shadeColorFactor.multiplyScalar(SHADE_DARKEN);
  material.shadingShiftFactor = SHADE_SHIFT;
  material.shadingToonyFactor = SHADE_TOONY;
  material.needsUpdate = true;
}

function setUpCharacter(gltf, source) {
  const loaded = { key: source.key, label: source.label, bones: {} };
  loaded.vrm = gltf.userData.vrm;
  {
    const vrm = loaded.vrm;
    VRMUtils.rotateVRM0(vrm); // no-op for VRM1 models, safe either way
    loaded.modelYaw = vrm.scene.rotation.y;
    loaded.rigIsMirrored = loaded.modelYaw !== 0;
    vrm.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        for (const material of (Array.isArray(obj.material) ? obj.material : [obj.material])) {
          deepenToonShading(material);
        }
      }
    });
    vrm.scene.visible = false;
    scene.add(vrm.scene);

    vrm.humanoid.resetNormalizedPose();

    const names = [
      'hips', 'spine', 'chest', 'neck', 'head',
      'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg',
      'rightUpperLeg', 'rightLowerLeg',
      'leftFoot', 'rightFoot',
      'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
      'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
      'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
      'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
      'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
      'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
      'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
      'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
      'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
      'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
    ];
    for (const name of names) {
      loaded.bones[name] = vrm.humanoid.getNormalizedBoneNode(name);
    }

    // The normalized hips bone's own rest position already encodes standing
    // pelvis height above the ground (feet are at the model's local y=0, hips
    // are not) — capture it so pose code can offset FROM it instead of
    // overwriting it with world-origin (0,0,0), which was collapsing her
    // pelvis reference down to ground level and sinking the whole lower body.
    loaded.hipsBaseY = loaded.bones.hips.position.y;

    // Hand the eyes a target to follow. autoUpdate means VRM re-reads its
    // world position on every vrm.update(), so applyGaze only has to move it.
    if (vrm.lookAt) vrm.lookAt.target = gazeTarget;

    calmSpringBones(vrm);
  }
  return loaded;
}

// Swapping the active character swaps the whole set of globals the pose code
// writes through. They stay module-level rather than being threaded through
// every pose function: the poses are written against "the character", and
// there is only ever one of those on stage.
function setActiveCharacter(key) {
  const next = cast.find((entry) => entry.key === key);
  if (!next || next === activeCharacter) return;
  if (activeCharacter) activeCharacter.vrm.scene.visible = false;

  activeCharacter = next;
  vrm = next.vrm;
  modelYaw = next.modelYaw;
  rigIsMirrored = next.rigIsMirrored;
  hipsBaseY = next.hipsBaseY;
  for (const name of Object.keys(bones)) delete bones[name];
  Object.assign(bones, next.bones);

  vrm.scene.visible = true;
  vrm.scene.position.copy(state.position);
  vrm.scene.rotation.y = facing + modelYaw;
  if (vrm.lookAt) vrm.lookAt.target = gazeTarget;
}

// The first character to arrive goes on stage and starts the page; the rest
// load behind her. Waiting for all three would hold the whole page on the
// slowest download for no reason.
CHARACTER_SOURCES.forEach((source, index) => {
  loadCharacter(source).then((loaded) => {
    cast.push(loaded);
    cast.sort((a, b) => CHARACTER_SOURCES.findIndex((s) => s.key === a.key)
      - CHARACTER_SOURCES.findIndex((s) => s.key === b.key));
    if (activeCharacter) {
      if (photoGame) photoGame.castChanged();
      return;
    }
    {
      setActiveCharacter(loaded.key);
      state.ready = true;
      window.__char.ready = true;
    if (loadingEl) loadingEl.style.display = 'none';

      photoGame = initPhotoGame({
        getState: () => window.__char.getState(),
        measureFraming,
        takePhoto,
        listCast: () => cast.map((entry) => ({ key: entry.key, label: entry.label })),
        getCharacter: () => (activeCharacter ? activeCharacter.key : null),
        setCharacter: setActiveCharacter,
        setSun,
        lightAngle: lightAngleDegrees,
        getExposure: () => ({
          auto: autoExposure, compensation: exposureCompensation, metered: lastMeteredLuma,
        }),
        setCompensation: (stops) => {
          exposureCompensation = THREE.MathUtils.clamp(stops, -COMPENSATION_LIMIT, COMPENSATION_LIMIT);
          applyExposure();
          return exposureCompensation;
        },
        compensationLimit: COMPENSATION_LIMIT,
        setPose: setPoseKeys,
        setExpression: (name) => { heldExpression = name; },
        danceReach,
        takeBurst,
        encodeFrame,
        setDirectorActive: (on) => { if (on) startDirector(); else stopDirector(); },
        startScenario,
        scenarioPeaks,
      });
    }
  }, (err) => {
    console.error(`Failed to load VRM character ${source.key}`, err);
    if (loadingEl) loadingEl.textContent = 'モデルの読み込みに失敗しました';
  });
});

// ---- Camera: orbit around the character, drag to look from any angle ----
// (this is also how you can actually see her face — the old fixed
// behind-the-back follow camera never showed it).
camera.position.set(0, 2.6, -4.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
// Close enough for a real portrait. It used to stop at 1.8m, which is a full
// figure — at that range her head is 9% of the frame height, so "寄り" and
// "標準" were the same picture and there was nothing for the photo game's
// framing brief to ask for.
controls.minDistance = 0.7;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.49;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

function updateCamera() {
  controls.target.lerp(state.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.15);
  controls.update();
}

// ---- Procedural animation ----
// This VRM avatar ships with a humanoid skeleton but no animation clips
// (unlike Mixamo-style rigs), so every pose here is hand-authored bone
// rotation applied every frame rather than played from a baked clip.
//
// VRM's normalized rest pose is a T-pose (arms straight out to the sides) —
// that's the whole point of "normalized" bones, a shared reference frame
// across avatars with different bind poses. It's not a natural standing
// pose, so the arms need an explicit down rotation as a baseline, with
// every other pose layered on top of it.
const ARM_DOWN_Z = -1.3;

// Both hands' finger bones, so resetLimbs can clear them in one pass. Held as
// a list rather than written out per bone because the double peace needs the
// left hand cleared on exactly the same terms the right already was.
const FINGER_BONES = [];
for (const side of ['left', 'right']) {
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const segments = finger === 'Thumb'
      ? ['Metacarpal', 'Proximal', 'Distal']
      : ['Proximal', 'Intermediate', 'Distal'];
    for (const segment of segments) FINGER_BONES.push(side + finger + segment);
  }
}

// How far each joint of a folded finger curls, in order out from the knuckle,
// about the finger's own Z — the axis that folds it toward the palm. Y, used
// here before, is the axis that sweeps a finger sideways across the palm: it
// hid behind a palm-facing camera well enough to look folded, while actually
// laying the ring and little fingers flat across the base of the other two.
//
// The three joints get different angles because a real folded finger is not an
// arc of constant curvature — the knuckle and the middle joint carry most of
// the fold and the last one trails. Measured, not guessed: these are the
// angles that put the fingertip back down on the palm (1.2cm off it) with the
// middle joint standing 2.8cm clear of it, which is the shelf the thumb needs.
const FINGER_CURL = [1.4, 1.7, 1.0];

// The thumb, in the same order out from the wrist. It folds across the palm
// rather than down onto it, so that its tip comes to rest on top of the folded
// ring finger — where a real hand parks it in a peace sign, and what stops it
// reading as a spare digit sticking out of the sleeve.
//
// Solved against the rig rather than authored: tools/measure_grip.js prints
// where the thumb tip lands relative to the folded ring finger, and these
// angles are the ones that land it 0.8cm above the ring finger's middle
// phalanx. Deliberately no X component — X is each thumb bone's own twist
// axis, and a solution that leans on it poses the thumb by rolling it rather
// than by bending it.
const THUMB_FOLD = [
  [0, -0.55, 0.4],    // metacarpal: swings the whole thumb in over the palm
  [0, -1.05, -0.1],   // proximal: the main fold, bringing it across the fingers
  [0, -0.75, 0],      // distal: lays the tip down on the ring finger
];

// The fingers a peace sign folds away, per side. Index and middle stay at
// their already-open rest pose, which is what makes the V read.
//
// `sign` is +1 on the right hand and -1 on the left: this rig mirrors left to
// right by negating Y and Z, which is every component these poses use.
function curlSpareFingers(side, sign) {
  for (const finger of ['Ring', 'Little']) {
    ['Proximal', 'Intermediate', 'Distal'].forEach((segment, joint) => {
      const bone = bones[side + finger + segment];
      if (bone) bone.rotation.set(0, 0, sign * FINGER_CURL[joint]);
    });
  }
  ['Metacarpal', 'Proximal', 'Distal'].forEach((segment, joint) => {
    const bone = bones[side + 'Thumb' + segment];
    const [x, y, z] = THUMB_FOLD[joint];
    if (bone) bone.rotation.set(x, sign * y, sign * z);
  });
}

// Turning her to face the camera when she is standing still — this is what
// lets you see her face without fighting the camera.
//
// The snap is the point. An exponential ease never actually arrives, and the
// step's dt is capped (so a slow frame advances the ease by less than the real
// time it took), which on a slow device leaves the last few degrees taking
// seconds — measured at 7 degrees off after a full 8 seconds of standing
// still on a throttled renderer. That residue is what read as "she is always
// standing at a slight angle". Easing the first 99% still looks better than
// snapping the whole turn, so both are kept.
const FACE_CAMERA_RATE = 6;      // per second, of the remaining angle
const FACE_CAMERA_SNAP = 0.01;   // rad; about half a degree, below seeing

// Held off only by the gaze tests, which need her heading to stay put while
// they move the camera around her — with this on, no pose leaves it alone.
let autoFace = true;

function turnToFaceCamera(dt) {
  if (!autoFace) return;
  const toCameraX = camera.position.x - state.position.x;
  const toCameraZ = camera.position.z - state.position.z;
  if (toCameraX * toCameraX + toCameraZ * toCameraZ < 0.0001) return;

  const target = Math.atan2(toCameraX, toCameraZ);
  let delta = target - facing;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest-path wrap
  facing = Math.abs(delta) < FACE_CAMERA_SNAP
    ? target
    : facing + delta * Math.min(1, dt * FACE_CAMERA_RATE);

  vrm.scene.rotation.y = facing + modelYaw;
  state.heading = facing;
}

let walkCycle = 0;
let actionCycle = 0;
let prevAction = 'idle';
let facing = 0; // smoothed heading used only for the idle "face the camera" turn

function resetLimbs() {
  bones.leftUpperLeg.rotation.set(0, 0, 0);
  bones.rightUpperLeg.rotation.set(0, 0, 0);
  bones.leftLowerLeg.rotation.set(0, 0, 0);
  bones.rightLowerLeg.rotation.set(0, 0, 0);
  bones.leftUpperArm.rotation.set(0, 0, ARM_DOWN_Z);
  bones.rightUpperArm.rotation.set(0, 0, -ARM_DOWN_Z);
  bones.leftLowerArm.rotation.set(0.12, 0, 0);
  bones.rightLowerArm.rotation.set(0.12, 0, 0);
  bones.leftHand.rotation.set(0, 0, 0);
  bones.rightHand.rotation.set(0, 0, 0);
  bones.leftFoot.rotation.set(0, 0, 0);
  bones.rightFoot.rotation.set(0, 0, 0);
  // The rest pose for these fingers is already a natural relaxed-open hand
  // (confirmed in a screenshot) — zeroing them here is what makes it safe
  // for the peace poses to only touch the fingers they need to curl.
  for (const name of FINGER_BONES) {
    const bone = bones[name];
    if (bone) bone.rotation.set(0, 0, 0);
  }
  bones.hips.position.set(0, hipsBaseY, 0);
  bones.hips.rotation.set(0, 0, 0);
  bones.chest.rotation.set(0, 0, 0);
  bones.head.rotation.set(0, 0, 0);
}

function applyWalk(running, dt) {
  walkCycle += dt * (running ? 8.2 : 5.6);
  const swing = Math.sin(walkCycle);

  // Kept deliberately gentler than a generic/masculine stride: a narrower
  // leg swing, a smaller arm swing held close to the body, and a light
  // side-to-side hip sway with a counter-sway at the shoulders — the combo
  // that reads as a "cute"/feminine walk rather than a wide marching gait.
  const legAmp = running ? 0.5 : 0.3;
  const kneeAmp = running ? 0.85 : 0.5;
  const armAmp = running ? 0.6 : 0.16;
  // Running pumps the arms with a bent elbow so the hands ride at waist
  // height instead of dangling at the thighs. Measured against the bones:
  // hips (waist) sit at y=0.879 and these values put the hand at 0.976 at
  // the front of the swing and 0.821 at the back — a mean of 0.898, i.e.
  // the pump is centred on the waist. The elbow hinge is the forearm's Y
  // axis (X is the roll axis and moves the hand not at all); the small
  // negative Z is what keeps the hands from flaring outside the shoulders,
  // which a pure Y bend does on its own.
  const elbowBend = running ? 0.9 : 0.25;
  const elbowRoll = running ? -0.5 : -0.15;
  const hipSwayAmp = running ? 0.05 : 0.09;
  const bounceAmp = running ? 0.075 : 0.028;

  bones.leftUpperLeg.rotation.x = swing * legAmp;
  bones.rightUpperLeg.rotation.x = -swing * legAmp;

  // Smooth knee bend that peaks mid-swing (leg lifting off the ground) and
  // eases to straight at the front/back of the stride, instead of a hard
  // clamp that snaps — that snap was a big part of what read as "not
  // regular bipedal walking."
  const leftKnee = Math.max(0, Math.sin(walkCycle - 0.5));
  const rightKnee = Math.max(0, Math.sin(walkCycle + Math.PI - 0.5));
  bones.leftLowerLeg.rotation.x = leftKnee * kneeAmp;
  bones.rightLowerLeg.rotation.x = rightKnee * kneeAmp;

  bones.leftUpperArm.rotation.x = -swing * armAmp;
  bones.rightUpperArm.rotation.x = swing * armAmp;
  bones.leftLowerArm.rotation.set(0.12, -elbowBend, elbowRoll);
  bones.rightLowerArm.rotation.set(0.12, elbowBend, -elbowRoll);

  bones.hips.rotation.z = swing * hipSwayAmp;
  bones.hips.rotation.y = swing * hipSwayAmp * 0.35;
  bones.hips.position.y = hipsBaseY + Math.abs(Math.sin(walkCycle * 2)) * bounceAmp;

  bones.chest.rotation.x = 0.035 + (running ? 0.05 : 0);
  bones.chest.rotation.z = -swing * hipSwayAmp * 0.6;

  setAnimName(running ? 'run' : 'walk');
}

function applyWave(dt) {
  actionCycle += dt * 6.5;
  // Measured against the actual bone matrices: the elbow needs to sit about
  // 10cm below the shoulder (a raised-but-relaxed wave, not a stiff salute),
  // which took a much steeper shoulder pitch than it looks like it should —
  // x=-1.8 here, verified against the shoulder joint's own world Y.
  bones.rightUpperArm.rotation.set(-1.8, -0.4, -0.5);
  bones.rightLowerArm.rotation.set(0.1, 1.7, 0);
  // The palm was facing up/away rather than toward the viewer — rightHand's
  // local X is the twist axis that rolls it to face forward, independent of
  // the Y-axis side-to-side swing below (confirmed the palm stays forward
  // through both swing extremes, not just the rest frame).
  const SWING_DEG = 30;
  bones.rightHand.rotation.set(-1.0, Math.sin(actionCycle) * (SWING_DEG * Math.PI / 180), 0);
  setAnimName('wave');
}

function applyPeace(dt) {
  actionCycle += dt * 1.2;
  // Reuses the wave's verified raised-arm formula (elbow below shoulder,
  // palm rolled to face the viewer via the hand's local X) — same shoulder
  // height reads fine for a held-up peace sign, just without the wrist swing.
  bones.rightUpperArm.rotation.set(-1.8, -0.4, -0.5);
  bones.rightLowerArm.rotation.set(0.1, 1.7, 0);
  bones.rightHand.rotation.set(-1.0, 0, 0);
  curlSpareFingers('right', 1);
  bones.head.rotation.x = Math.sin(actionCycle * 0.6) * 0.015; // subtle breathing, not a stiff freeze
  setAnimName('peace');
}

// Both hands up beside the face, the way you'd actually hold a double peace
// for a photo, rather than the single sign's shoulder-height hold. Getting the
// hands next to the cheeks is mostly the elbow: a near-full fold (Y=2.3) is
// what carries the hand up past the jaw, while the shoulder angle only decides
// how wide the elbows sit. Tuned against the bones rather than by eye — see
// tools/measure_pose.js, which prints each hand's world position relative to
// the head so "beside the face" is a number and not a guess.
const DOUBLE_PEACE_SHOULDER_X = -1.45;
const DOUBLE_PEACE_SHOULDER_Y = -0.35;
const DOUBLE_PEACE_SHOULDER_Z = -0.62;
const DOUBLE_PEACE_ELBOW = 2.3;

function applyDoublePeace(dt) {
  actionCycle += dt * 1.2;
  bones.rightUpperArm.rotation.set(DOUBLE_PEACE_SHOULDER_X, DOUBLE_PEACE_SHOULDER_Y, DOUBLE_PEACE_SHOULDER_Z);
  bones.leftUpperArm.rotation.set(DOUBLE_PEACE_SHOULDER_X, -DOUBLE_PEACE_SHOULDER_Y, -DOUBLE_PEACE_SHOULDER_Z);
  bones.rightLowerArm.rotation.set(0.1, DOUBLE_PEACE_ELBOW, 0);
  bones.leftLowerArm.rotation.set(0.1, -DOUBLE_PEACE_ELBOW, 0);
  // Same palm-forward twist as the single sign, mirrored on the left.
  bones.rightHand.rotation.set(-1.0, 0, 0);
  bones.leftHand.rotation.set(-1.0, 0, 0);
  curlSpareFingers('right', 1);
  curlSpareFingers('left', -1);
  // A small head tilt — the pose is a photo pose, and a dead-level head makes
  // it read as a shrug instead.
  bones.head.rotation.z = 0.12;
  bones.head.rotation.x = 0.05 + Math.sin(actionCycle * 0.6) * 0.015;
  bones.chest.rotation.x = 0.03;
  setAnimName('double-peace');
}

// ---- Dance ----
// A short routine on a fixed beat, built to give a photographer something to
// wait for. A smooth loop is unphotographable: every frame looks like every
// other frame, so there is no moment to catch and nothing to learn about
// timing. This one has a peak — both arms thrown up, on the hop — that lasts a
// fraction of a second and then it is gone.
const DANCE_BPM = 104;
const DANCE_BEAT = 60 / DANCE_BPM;
const DANCE_BARS = 4;                          // beats before the routine repeats
const DANCE_HOP_HEIGHT = 0.09;

let danceTime = 0;

function applyDance(dt) {
  danceTime = (danceTime + dt) % (DANCE_BEAT * DANCE_BARS);
  const beat = danceTime / DANCE_BEAT;         // 0..4
  const swing = Math.sin(beat * Math.PI);      // one arc per beat
  const bounce = Math.abs(Math.sin(beat * Math.PI));

  // The peak lands on the fourth beat: arms overhead, up on the toes. Eased
  // with a power curve rather than a sine so it is genuinely brief — the
  // window you have to hit is about a sixth of a second — which is why the
// burst exists.
  const toPeak = Math.max(0, 1 - Math.abs(beat - 3.5) / 0.7);
  const peak = Math.pow(toPeak, 1.6);

  // Z is the axis that raises an arm on this rig: the rest pose holds the right
  // arm at +1.3 (hanging), 0 is straight out to the side, and negative is
  // overhead. X barely lifts at all — the jump pose learned the same thing the
  // hard way. Written the other way round first, and she danced the whole
  // routine with both arms held out sideways.
  const lift = 0.95 - peak * 1.75 + swing * 0.30;
  bones.rightUpperArm.rotation.set(-0.1 - peak * 0.15, -0.2 + peak * 0.2, lift);
  bones.leftUpperArm.rotation.set(-0.1 - peak * 0.15, 0.2 - peak * 0.2, -lift);
  bones.rightLowerArm.rotation.set(0, 1.0 - peak * 0.95, 0);
  bones.leftLowerArm.rotation.set(0, -1.0 + peak * 0.95, 0);

  // Hips and shoulders counter-rotate on the offbeat, which is what makes it
  // read as dancing rather than as arm-waving.
  const sway = Math.sin(beat * Math.PI * 0.5);
  bones.hips.rotation.set(0, sway * 0.22, -sway * 0.1);
  bones.chest.rotation.set(0.03 + peak * -0.12, -sway * 0.3, sway * 0.12);
  bones.head.rotation.set(-peak * 0.18, -sway * 0.18, sway * 0.1);

  const knee = (1 - bounce) * 0.35 + peak * -0.2;
  bones.leftUpperLeg.rotation.set(-knee * 0.5, 0, 0.04);
  bones.rightUpperLeg.rotation.set(-knee * 0.5, 0, -0.04);
  bones.leftLowerLeg.rotation.set(knee, 0, 0);
  bones.rightLowerLeg.rotation.set(knee, 0, 0);

  bones.hips.position.y = hipsBaseY + peak * DANCE_HOP_HEIGHT - (1 - bounce) * 0.03;
  setAnimName('dance');
}

// What a photographer is actually waiting for, measured off the rig rather
// than off the beat clock: how far her hands are above her head. Reading the
// clock would score the moment the routine *should* be at, which is not the
// same as the frame that was captured.
function danceReach() {
  if (!vrm || !vrm.humanoid) return 0;
  const head = vrm.humanoid.getRawBoneNode('head');
  const left = vrm.humanoid.getRawBoneNode('leftHand');
  const right = vrm.humanoid.getRawBoneNode('rightHand');
  if (!head || !left || !right) return 0;
  for (const bone of [head, left, right]) bone.updateWorldMatrix(true, false);
  const headY = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y;
  const handY = Math.max(
    new THREE.Vector3().setFromMatrixPosition(left.matrixWorld).y,
    new THREE.Vector3().setFromMatrixPosition(right.matrixWorld).y
  );
  return handY - headY;
}

function applyCrouch(dt) {
  actionCycle += dt * 3.2;
  const squat = (Math.sin(actionCycle - Math.PI / 2) + 1) / 2; // 0 -> 1 -> 0, starts at 0
  // Solved against the actual bone matrices rather than eyeballed, because
  // two things were wrong by inspection alone:
  //
  // 1. Sign. On this rig positive upperLeg.rotation.x swings the thigh
  //    BACKWARD, so a forward hip fold needs a negative angle; lowerLeg is
  //    the opposite. Both were inverted before, folding the legs backward
  //    like a reversed knee.
  // 2. Balance. Even once the knee pointed forward, the pelvis sat ~0.23
  //    behind the ankle — with the whole body's centre of mass behind the
  //    heel, a real person would simply topple over backwards. The fix is
  //    the pair below: the shin has to pitch the knee well forward of the
  //    ankle, and the hips translate forward (position.z) as they drop, not
  //    just straight down. That lands the mass centre near mid-foot.
  //
  // The y/z hip offsets are the exact translation that keeps the ankle at
  // its standing height and position, so the feet stay planted instead of
  // sliding or sinking. The y term on the upper legs turns the toes out so
  // the feet track under the splayed knees.
  const SPLAY = squat * 0.35;   // knees open outward (a squat with the thighs
  const TOE_OUT = squat * 0.3;  // clamped shut reads stiff and unnatural)
  bones.leftUpperLeg.rotation.set(-squat * 1.6, -TOE_OUT, SPLAY);
  bones.rightUpperLeg.rotation.set(-squat * 1.6, TOE_OUT, -SPLAY);
  bones.leftLowerLeg.rotation.x = squat * 2.3;
  bones.rightLowerLeg.rotation.x = squat * 2.3;
  bones.hips.position.y = hipsBaseY - squat * 0.471;
  bones.hips.position.z = -squat * 0.144;
  bones.chest.rotation.x = squat * 0.34;
  // Routing the forearms down between the knees (the previous fix) read as
  // the hands hanging disconnected from the body, not resting on anything —
  // the actual reference for this pose is hands pressed onto the knees,
  // holding the skirt hem down against the legs. A pure forward pitch (X)
  // with no lateral Y pull lands the hand almost exactly on the knee joint
  // (measured: 0.03 units apart), reading as the hand resting flat on top of
  // the thigh/knee rather than crossing through it at an angle — confirmed
  // clean from front, side, and 3/4 views.
  bones.leftUpperArm.rotation.set(-squat * 1.0, 0, ARM_DOWN_Z);
  bones.rightUpperArm.rotation.set(-squat * 1.0, 0, -ARM_DOWN_Z);
  bones.leftLowerArm.rotation.set(0.12 + squat * 0.5, 0, 0);
  bones.rightLowerArm.rotation.set(0.12 + squat * 0.5, 0, 0);
  // The foot bone doesn't automatically stay flat when the shin pitches
  // forward — it inherits that same pitch, tipping the sole onto its toe
  // and lifting the heel off the ground. Counter-rotate the ankle back
  // toward the shin's angle so the sole stays roughly parallel to the floor.
  bones.leftFoot.rotation.x = -squat * 0.6;
  bones.rightFoot.rotation.x = -squat * 0.6;
  setAnimName('crouch');
}

function applyIdle(dt) {
  actionCycle += dt * 1.6;
  bones.chest.rotation.x = Math.sin(actionCycle * 0.6) * 0.012;
  bones.head.rotation.x = Math.sin(actionCycle * 0.5) * 0.02;
  setAnimName('idle');
}

// ---- Story poses ----
// These three exist to give the bird's visit something to happen to. A pose
// with no cause is the thing that read as wrong before -- she would drop into
// a squat mid-photoshoot for no reason -- so each of these is written to be
// legible as a reaction: offering a perch, crouching down to look at
// something, watching it leave.

// Right arm held out, palm up, for the bird to land on. Measured rather than
// eyeballed: tools/measure_pose.js reports the hand ~0.36m in front of her
// chest and level with it, which is where a hand you are offering actually
// goes -- higher reads as a salute and lower as holding a bag.
// Solved on the rig rather than guessed. The first attempt (-1.02, -0.12,
// 0.62) read as a scarecrow: measured in her own frame it put the hand 0.53
// out to the side and only 0.06 in front of her, because on this arm the Z
// term is what swings the limb away from the body and X alone cannot pull it
// round to the front. tools/measure_pose-style sweep over (x, y, z) picked
// these, which land the hand 0.43 in front, 0.15 to her right and 0.19 below
// the head -- an offered hand just under her chin, which is also where a bird
// perched on it stays in the same frame as her face on a close-up.
function applyReachOut(dt) {
  actionCycle += dt * 1.1;
  bones.rightUpperArm.rotation.set(-1.2, 0.25, 1.5);
  bones.rightLowerArm.rotation.set(0, 0.32, 0);
  // Palm turned up, which is both what makes it an offer and what gives the
  // bird a surface. Same twist axis as the wave's palm-to-camera roll.
  bones.rightHand.rotation.set(0.55, 0, 0);
  bones.chest.rotation.set(0.02, -0.16, 0);
  // Watching her own hand rather than the camera -- her attention is on the
  // bird, and a face pointed at the lens would undo that.
  bones.head.rotation.set(0.14 + Math.sin(actionCycle) * 0.01, -0.3, 0.04);
  setAnimName('reach-out');
}

// Crouched down and holding it, looking at something on the ground. The
// existing 'crouch' is a rhythmic squat -- an exercise, which is why it read
// as bizarre when the director dropped it into a photo session unprompted.
// This one goes down once and stays, with a reason to be down there.
// Shallower than the exercise squat's full depth, and with the knees almost
// together rather than splayed. Both are modesty, not style: she is wearing a
// short skirt, and the deep splayed version -- which is what the exercise
// squat does, correctly, as an exercise -- shows underwear from the front at
// exactly the framing the brief asks a close-up for. Screenshotted from the
// front and the three-quarter before and after.
const CROUCH_LOOK_DEPTH = 0.58;   // fraction of the squat's full depth
const CROUCH_LOOK_SPLAY = 0.06;   // knees nearly closed
const CROUCH_LOOK_TOE_OUT = 0.1;
let crouchArmOverride = null;

function applyCrouchLook(dt) {
  actionCycle += dt * 1.4;
  const squat = CROUCH_LOOK_DEPTH;
  // The same balance solution as applyCrouch: the shin pitches the knee
  // forward of the ankle and the hips translate forward as they drop, or the
  // whole mass centre ends up behind the heel and she should topple.
  const SPLAY = squat * CROUCH_LOOK_SPLAY;
  const TOE_OUT = squat * CROUCH_LOOK_TOE_OUT;
  bones.leftUpperLeg.rotation.set(-squat * 1.6, -TOE_OUT, SPLAY);
  bones.rightUpperLeg.rotation.set(-squat * 1.6, TOE_OUT, -SPLAY);
  bones.leftLowerLeg.rotation.x = squat * 2.3;
  bones.rightLowerLeg.rotation.x = squat * 2.3;
  bones.hips.position.y = hipsBaseY - squat * 0.471;
  bones.hips.position.z = -squat * 0.144;
  bones.chest.rotation.set(squat * 0.3, 0, 0);
  // Hands resting on the knees -- the same arm solution as the exercise
  // squat, which was measured to land the hand within 0.03 of the knee joint
  // and checked from three angles. Reusing it rather than authoring a second
  // set of numbers, because the two poses put the knees in the same place.
  //
  // The Z sign is the trap here, and the first attempt fell into it. On this
  // rig the right arm hangs at -ARM_DOWN_Z (+1.3) and the left at ARM_DOWN_Z
  // (-1.3); writing +1.02 on the left and -1.02 on the right is not "arms
  // forward a little", it is each arm swung past vertical and across her own
  // body. The sign has to stay.
  const ux = crouchArmOverride ? crouchArmOverride.ux : -0.75;
  const fx = crouchArmOverride ? crouchArmOverride.fx : 0.45;
  bones.leftUpperArm.rotation.set(ux, 0, ARM_DOWN_Z);
  bones.rightUpperArm.rotation.set(ux, 0, -ARM_DOWN_Z);
  const fy = crouchArmOverride ? crouchArmOverride.fy : 0.35;
  bones.leftLowerArm.rotation.set(fx, -fy, 0);
  bones.rightLowerArm.rotation.set(fx, fy, 0);
  // Same ankle counter-rotation as the exercise squat: the foot inherits the
  // shin's forward pitch and tips onto its toe unless it is pushed back.
  bones.leftFoot.rotation.x = -squat * 0.6;
  bones.rightFoot.rotation.x = -squat * 0.6;
  // Head down at whatever she crouched to look at, with a little life in it.
  bones.head.rotation.set(0.34 + Math.sin(actionCycle) * 0.015, 0.06, 0);
  setAnimName('crouch-look');
}

// Head up, following something leaving. Paired with the sad expression this
// is the shot the bird's departure exists to create.
function applyLookUp(dt) {
  actionCycle += dt * 1.2;
  // Negative X on the head pitches it up -- the same direction the dance's
  // peak uses when she throws her head back.
  // -0.34 was too polite to read as looking up at all once she is also
  // turned to face the camera; from the front it just looked like standing.
  bones.head.rotation.set(-0.52 + Math.sin(actionCycle * 0.7) * 0.02, -0.12, 0.05);
  bones.chest.rotation.set(-0.13, -0.05, 0);
  // Arms fallen still at her sides, a fraction away from the body: hands
  // clamped flat to the thighs reads as standing to attention.
  bones.leftUpperArm.rotation.set(0, 0, ARM_DOWN_Z + 0.06);
  bones.rightUpperArm.rotation.set(0, 0, -ARM_DOWN_Z - 0.06);
  bones.leftLowerArm.rotation.set(0.1, -0.12, 0);
  bones.rightLowerArm.rotation.set(0.1, 0.12, 0);
  setAnimName('look-up');
}

const JUMP_MAX_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * JUMP_GRAVITY);

function applyJump() {
  // Driven by height-so-far rather than elapsed time, so the pose always
  // matches how far off the ground she actually is (0 at takeoff/landing, 1
  // at the apex) instead of drifting out of sync if the frame rate stutters.
  //
  // Reworked from a "cannonball" knees-forward tuck into a joyful leap
  // (reference: arms thrown up in a V, legs kicked back and bent, not
  // pulled up in front) — the earlier version read as defensive/curled-up
  // rather than celebratory. The arm angles here aren't a small tweak of
  // the wave's raised-arm formula (X=-1.8) — that pose is a modest
  // shoulder-height wave. Getting the hands genuinely overhead needed a
  // much smaller X (near 0) paired with a large Z swing; confirmed by
  // checking the hand's world Y ended up above the shoulder's, not just
  // eyeballing the rotation numbers. Legs: a big thigh swing (tried first)
  // kicked the foot up above shoulder height and hidden behind her own
  // torso in a render — dialed back to a small thigh rotation plus a big
  // knee fold instead, landing the heel near hip height.
  const tuck = THREE.MathUtils.clamp(state.position.y / JUMP_MAX_HEIGHT, 0, 1);
  bones.leftUpperLeg.rotation.x = tuck * 0.15;
  bones.rightUpperLeg.rotation.x = tuck * 0.15;
  bones.leftLowerLeg.rotation.x = tuck * 1.3;
  bones.rightLowerLeg.rotation.x = tuck * 1.3;
  bones.hips.position.y = hipsBaseY - tuck * 0.1;
  bones.leftFoot.rotation.x = tuck * 0.3; // toes point down, not stiffly flat, mid-air
  bones.rightFoot.rotation.x = tuck * 0.3;

  // Raised further still per feedback — z=1.2 puts the hand about 0.33
  // units above the head (checked against the head bone's own world Y).
  bones.leftUpperArm.rotation.set(0, 0, tuck * 1.2);
  bones.rightUpperArm.rotation.set(0, 0, -tuck * 1.2);
  bones.leftLowerArm.rotation.set(tuck * 0.15, 0, 0);
  bones.rightLowerArm.rotation.set(tuck * 0.15, 0, 0);

  bones.chest.rotation.x = -tuck * 0.15;
  setAnimName('jump');
}

function applyLanding() {
  // Quick, snappy absorb-and-recover instead of a lingering deep knee bend —
  // (1 - p)^2 front-loads the compression right at touchdown and eases it
  // out fast, since LANDING_RECOVER_TIME is deliberately short (0.18s).
  // The initial coefficients (0.5/0.75/0.12) were only visible zoomed in —
  // at normal camera distance the bend read as barely-there. Scaled up
  // (0.7/1.0/0.18) plus a bit more forward chest lean so the impact
  // actually reads at a normal viewing distance.
  const p = 1 - landingRecoverT / LANDING_RECOVER_TIME;
  const absorb = (1 - p) * (1 - p);
  bones.leftUpperLeg.rotation.x = -absorb * 0.7;
  bones.rightUpperLeg.rotation.x = -absorb * 0.7;
  bones.leftLowerLeg.rotation.x = absorb * 1.0;
  bones.rightLowerLeg.rotation.x = absorb * 1.0;
  bones.hips.position.y = hipsBaseY - absorb * 0.18;
  bones.chest.rotation.x = absorb * 0.22;
  bones.leftUpperArm.rotation.set(-absorb * 0.3, 0, ARM_DOWN_Z);
  bones.rightUpperArm.rotation.set(-absorb * 0.3, 0, -ARM_DOWN_Z);
  setAnimName('jump');
}

// ---- Gaze ----
// The eyes follow the camera, which is most of what makes her read as present
// rather than as a rig cycling through poses. Some of the turn is handed to
// the head as well: this model's VRM eye range is only 8-12 degrees
// horizontally, and at gameplay camera distance that much eye movement on its
// own is close to invisible.
const GAZE_TARGET_DISTANCE = 4;
const GAZE_EASE = 5;          // per second
const GAZE_HEAD_SHARE = 0.4;  // of the angle to the camera, taken by the head
const GAZE_HEAD_LIMIT = 0.5;  // radians (~29 degrees), so the neck stays plausible
// Within GAZE_FULL she looks straight at you; past GAZE_DROP she has given up
// and faces front. Ramping between the two rather than cutting matters — the
// camera orbits freely, and a hard switch reads as her losing interest in a
// single frame.
const GAZE_FULL_ANGLE = 1.3;  // ~75 degrees
const GAZE_DROP_ANGLE = 2.1;  // ~120 degrees

const gazeTarget = new THREE.Object3D();
scene.add(gazeTarget);
const gazeHeadPos = new THREE.Vector3();
const gazeToCamera = new THREE.Vector3();
let gazeAngle = 0;   // smoothed signed angle from her facing to the camera
let gazeWeight = 0;  // smoothed 0..1 interest

// What her eyes are on. Normally you -- but while the bird is in the air she
// is watching the bird, and that is most of what sells the story as cause and
// effect rather than as two things happening near each other. Once it has
// landed on her it is too close to track: the gaze maths divides by the
// horizontal distance, and a target 10cm from her own head sends the yaw to
// the stops. Perched, she looks back at the camera, which is the shot anyway.
const GAZE_BIRD_MIN_DISTANCE = 0.45;

function gazeFocus() {
  if (!bird.visible) return camera.position;
  const dx = bird.position.x - gazeHeadPos.x;
  const dz = bird.position.z - gazeHeadPos.z;
  if (Math.hypot(dx, dz) < GAZE_BIRD_MIN_DISTANCE) return camera.position;
  return bird.position;
}

function applyGaze(dt) {
  const rawHead = vrm.humanoid.getRawBoneNode('head');
  if (!rawHead) return;
  rawHead.updateWorldMatrix(true, false);
  gazeHeadPos.setFromMatrixPosition(rawHead.matrixWorld);

  const focus = gazeFocus();
  gazeToCamera.copy(focus).sub(gazeHeadPos);
  const horizontal = Math.hypot(gazeToCamera.x, gazeToCamera.z) || 1e-6;

  // Signed angle about Y from where she is facing to where the camera is.
  // Positive means the camera is off to her left, which is also the direction
  // a positive head yaw turns her.
  const fx = Math.sin(state.heading);
  const fz = Math.cos(state.heading);
  const cx = gazeToCamera.x / horizontal;
  const cz = gazeToCamera.z / horizontal;
  const angle = Math.atan2(fz * cx - fx * cz, fx * cx + fz * cz);

  const magnitude = Math.abs(angle);
  const interest = magnitude <= GAZE_FULL_ANGLE ? 1
    : magnitude >= GAZE_DROP_ANGLE ? 0
    : 1 - (magnitude - GAZE_FULL_ANGLE) / (GAZE_DROP_ANGLE - GAZE_FULL_ANGLE);

  const ease = Math.min(1, dt * GAZE_EASE);
  gazeWeight += (interest - gazeWeight) * ease;
  // Shortest-path wrap, so an orbit across the back of her head eases the
  // short way round instead of sweeping all the way through the front.
  let delta = angle - gazeAngle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  gazeAngle += delta * ease;

  // The head takes its share; the eyes pick up whatever is left over when the
  // lookAt applier aims them at the target below, and clamp at the model's own
  // range if that remainder is still more than the eyes can cover.
  const headYaw = THREE.MathUtils.clamp(
    gazeAngle * GAZE_HEAD_SHARE, -GAZE_HEAD_LIMIT, GAZE_HEAD_LIMIT
  ) * gazeWeight;
  bones.head.rotation.y += headYaw;

  const lookYaw = state.heading + gazeAngle * gazeWeight;
  // Scaled to the target distance so the pitch stays the angle to the camera
  // rather than shrinking as the camera pulls back.
  const rise = (focus.y - gazeHeadPos.y) * gazeWeight * (GAZE_TARGET_DISTANCE / horizontal);
  gazeTarget.position.set(
    gazeHeadPos.x + Math.sin(lookYaw) * GAZE_TARGET_DISTANCE,
    gazeHeadPos.y + rise,
    gazeHeadPos.z + Math.cos(lookYaw) * GAZE_TARGET_DISTANCE
  );
}

// Re-express the pose the animation functions just wrote so it means the same
// thing on a mirrored (VRM 0.x) rig.
//
// The mirror is a half-turn about Y, and conjugating a rotation by a half-turn
// about Y negates exactly its X and Z components — for XYZ-order Euler angles
// that is precisely Euler(-x, y, -z), so this pass is exact rather than an
// approximation. Doing it here, once, in one place, is what lets every pose
// above keep the angles they were measured and tuned with.
function conformPoseToRig() {
  if (!rigIsMirrored) return;
  for (const name in bones) {
    const bone = bones[name];
    if (!bone) continue;
    bone.rotation.x = -bone.rotation.x;
    bone.rotation.z = -bone.rotation.z;
  }
  bones.hips.position.x = -bones.hips.position.x;
  bones.hips.position.z = -bones.hips.position.z;
}

// ---- Face ----
// Which smile each action wears. Two different ones, because the model's
// 'happy' preset squeezes the eyes shut into a ^^ well before full weight —
// perfect for a held photo pose, wrong for the jump, where she is moving and
// a face with no eyes reads as a wince. 'relaxed' is the open-eyed smile.
const FACE_BY_ACTION = {
  peace: { happy: 0.9 },
  'double-peace': { happy: 1.0 },
  jump: { relaxed: 0.85 },
  wave: { relaxed: 0.75 },
};

// Every expression this file drives. Anything not listed here is left alone,
// so the visemes stay available for whatever wants them later.
const MANAGED_EXPRESSIONS = ['happy', 'relaxed', 'Surprised', 'angry', 'sad', 'Extra'];
// The ones that draw their own eyes, and so must not have a blink stacked on
// top: 'happy' squeezes them shut, 'Extra' replaces them with a drawn >_<, and
// 'Surprised' holds them wide. Blinking through any of those fights the morph
// and pops as the expression eases out.
const EYE_OWNING_EXPRESSIONS = ['happy', 'Extra', 'Surprised'];

const FACE_EASE = 9;         // per second; ~0.15s to settle
const BLINK_DURATION = 0.13;
const BLINK_MIN_GAP = 2.4;
const BLINK_MAX_GAP = 6.0;

const faceWeights = {};
for (const name of MANAGED_EXPRESSIONS) faceWeights[name] = 0;
let blinkCountdown = BLINK_MIN_GAP;
let blinkElapsed = BLINK_DURATION;

function applyFace(dt, action) {
  const expressions = vrm.expressionManager;
  if (!expressions) return;

  // A held expression key wins over whatever the current pose would wear, so
  // you can pull a face mid-run or scowl through a peace sign.
  const wanted = heldExpression ? { [heldExpression]: 1 } : (FACE_BY_ACTION[action] || {});

  // Eased rather than assigned outright: snapping an expression to full on a
  // keypress reads as a mask being swapped in, where a short ramp reads as her
  // reacting to what she's doing.
  let eyesOwned = 0;
  for (const name of MANAGED_EXPRESSIONS) {
    faceWeights[name] += ((wanted[name] || 0) - faceWeights[name]) * Math.min(1, dt * FACE_EASE);
    expressions.setValue(name, faceWeights[name]);
    if (EYE_OWNING_EXPRESSIONS.includes(name)) eyesOwned = Math.max(eyesOwned, faceWeights[name]);
  }

  blinkCountdown -= dt;
  if (blinkCountdown <= 0) {
    blinkCountdown = BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP);
    blinkElapsed = 0;
  }
  let lids = 0;
  if (blinkElapsed < BLINK_DURATION) {
    blinkElapsed += dt;
    // Shuts faster than it opens, which is what a real blink does; a symmetric
    // triangle reads as a slow deliberate wink.
    const p = Math.min(1, blinkElapsed / BLINK_DURATION);
    lids = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
  }
  expressions.setValue('blink', Math.max(0, lids) * (1 - eyesOwned));
}

const clock = new THREE.Clock();

function step(dt) {
  if (!vrm) return;

  if (directorActive) runDirector(dt);

  let moveX = 0;
  let moveZ = 0;
  if (keys.forward) moveZ += 1;
  if (keys.back) moveZ -= 1;
  if (keys.left) moveX -= 1;
  if (keys.right) moveX += 1;

  const moving = moveX !== 0 || moveZ !== 0;
  const running = moving && keys.run;
  // Jumping (and its brief landing recovery) outrank every other pose, but
  // horizontal movement keeps working the whole time — a "running jump" —
  // so the action name for animName/actionCycle purposes is independent of
  // whether WASD happens to also be held.
  const action = airborne || landingRecoverT > 0 ? 'jump'
    : moving ? (running ? 'run' : 'walk')
    : keys.wave ? 'wave'
    : keys.crouch ? 'crouch'
    : keys.doublePeace ? 'double-peace'
    : keys.peace ? 'peace'
    : 'idle';

  if (action !== prevAction) {
    actionCycle = 0;
    prevAction = action;
  }

  resetLimbs();

  // Horizontal movement is independent of jump/pose state so it still
  // applies mid-air; vertical position is independent of horizontal so a
  // running jump doesn't have to special-case anything below.
  if (moving) {
    state.heading = Math.atan2(moveX, moveZ);
    facing = state.heading;
    vrm.scene.rotation.y = state.heading + modelYaw;

    const speed = running ? RUN_SPEED : MOVE_SPEED;
    const dir = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    state.position.addScaledVector(dir, speed * dt);
  }

  if (airborne) {
    velocityY -= JUMP_GRAVITY * dt;
    state.position.y += velocityY * dt;
    if (state.position.y <= 0) {
      state.position.y = 0;
      velocityY = 0;
      airborne = false;
      landingRecoverT = LANDING_RECOVER_TIME;
    }
  } else if (landingRecoverT > 0) {
    landingRecoverT = Math.max(0, landingRecoverT - dt);
  }
  vrm.scene.position.copy(state.position);

  if (airborne) {
    applyJump();
  } else if (moving) {
    applyWalk(running, dt);
  } else {
    // Everything she does standing still, she does facing you. This used to
    // run for idle alone, which left her holding a peace sign at whatever
    // angle she happened to stop walking at.
    turnToFaceCamera(dt);

    if (landingRecoverT > 0) applyLanding();
    else if (keys.wave) applyWave(dt);
    else if (keys.crouch) applyCrouch(dt);
    else if (keys.doublePeace) applyDoublePeace(dt);
    else if (keys.peace) applyPeace(dt);
    else if (keys.dance) applyDance(dt);
    else if (keys.reachOut) applyReachOut(dt);
    else if (keys.crouchLook) applyCrouchLook(dt);
    else if (keys.lookUp) applyLookUp(dt);
    else applyIdle(dt);
  }

  blendPoseChange(dt);
  applyGaze(dt);
  conformPoseToRig();
  applyFace(dt, action);

  vrm.update(dt);
  updateCamera();
}

// ---- Pose cross-fade ----
// Every pose in this file writes absolute bone rotations every frame, so
// switching between two of them used to be a hard cut: one frame standing,
// the next frame fully squatted. That is most of what read as "sudden" about
// the director's pose changes -- not only that a squat had no reason, but
// that she teleported into it.
//
// This holds a snapshot of the bones as they were at the instant of a switch
// and eases the new pose in over it. It runs after the pose functions and
// before conformPoseToRig, so both sides of the blend are in the same
// authored space -- blending after the mirror conjugation would mix two
// different conventions and produce a pose that is neither.
const POSE_BLEND_TIME = 0.42;
// A jump is a snap by nature -- it lasts well under a second, and easing into
// it over 0.42s smears the launch into a slow rise. Walking is the same: the
// stride is already a continuous cycle, so a long fade into it reads as her
// sliding before her legs catch up.
const POSE_BLEND_FAST = 0.12;
const FAST_BLEND_POSES = new Set(['jump', 'walk', 'run']);
let poseBlendTime = POSE_BLEND_TIME;
// Every bone a pose function can touch. Written out rather than derived from
// `bones`, because the finger bones are set by the peace signs through their
// own path and re-blending them fights that.
const BLEND_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

// Two preallocated buffers rather than fresh objects: this runs every frame,
// and a per-frame object literal per bone is garbage the collector then has
// to find during the exact animation it would be visible in.
const prevAuthored = makePoseBuffer();
const blendFrom = makePoseBuffer();
let prevAuthoredValid = false;
let blendRemaining = 0;

function makePoseBuffer() {
  const buffer = { rotations: {}, hips: { y: 0, z: 0 } };
  for (const name of BLEND_BONES) buffer.rotations[name] = { x: 0, y: 0, z: 0 };
  return buffer;
}

function capturePose(buffer) {
  for (const name of BLEND_BONES) {
    const bone = bones[name];
    if (!bone) continue;
    const slot = buffer.rotations[name];
    slot.x = bone.rotation.x;
    slot.y = bone.rotation.y;
    slot.z = bone.rotation.z;
  }
  if (bones.hips) {
    buffer.hips.y = bones.hips.position.y;
    buffer.hips.z = bones.hips.position.z;
  }
}

function copyPose(from, to) {
  for (const name of BLEND_BONES) {
    const source = from.rotations[name];
    const target = to.rotations[name];
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
  }
  to.hips.y = from.hips.y;
  to.hips.z = from.hips.z;
}

// Called by setAnimName, which every pose function already ends with, so a
// pose does not have to remember to announce itself twice.
//
// The frame this is called on has already had the *new* pose written to the
// bones, so the pose to fade out of is not readable here -- it is the one
// captured at the end of the previous frame. Hence prevAuthored, which
// step() refreshes after every blend.
function notePoseChange(name) {
  if (!prevAuthoredValid) return;
  copyPose(prevAuthored, blendFrom);
  poseBlendTime = FAST_BLEND_POSES.has(name) ? POSE_BLEND_FAST : POSE_BLEND_TIME;
  blendRemaining = poseBlendTime;
}

function blendPoseChange(dt) {
  if (blendRemaining > 0) {
    blendRemaining = Math.max(0, blendRemaining - dt);
    // Smoothstep rather than linear: a linear cross-fade starts and stops
    // abruptly, which on a whole-body change is its own kind of visible.
    const linear = 1 - blendRemaining / poseBlendTime;
    const t = linear * linear * (3 - 2 * linear);
    const previous = 1 - t;

    for (const name of BLEND_BONES) {
      const bone = bones[name];
      const was = blendFrom.rotations[name];
      if (!bone) continue;
      bone.rotation.x = bone.rotation.x * t + was.x * previous;
      bone.rotation.y = bone.rotation.y * t + was.y * previous;
      bone.rotation.z = bone.rotation.z * t + was.z * previous;
    }
    if (bones.hips) {
      bones.hips.position.y = bones.hips.position.y * t + blendFrom.hips.y * previous;
      bones.hips.position.z = bones.hips.position.z * t + blendFrom.hips.z * previous;
    }
  }

  // Captured after the blend, so interrupting a cross-fade half way fades
  // out of where she visibly is rather than snapping back to the pose she
  // was already leaving. Still before conformPoseToRig, so everything the
  // blend touches stays in one convention.
  capturePose(prevAuthored);
  prevAuthoredValid = true;
}

// ---- What the photo game needs to see ----
// How much of the frame her head fills, and where in the frame it sits. Both
// come out of the same projection, in fractions of the viewport rather than
// pixels, so a phone in portrait and a desktop window are judged on what the
// picture actually looks like rather than on how far away the camera is.
const HEAD_HEIGHT = 0.16;   // metres, head bone to the top of her hair

const projected = new THREE.Vector3();
const projectedTop = new THREE.Vector3();

function measureFraming() {
  const head = vrm && vrm.humanoid ? vrm.humanoid.getRawBoneNode('head') : null;
  if (!head) return null;
  head.updateWorldMatrix(true, false);
  projected.setFromMatrixPosition(head.matrixWorld);
  projectedTop.copy(projected).setY(projected.y + HEAD_HEIGHT);

  // Behind the camera projects to nonsense, so say so rather than reporting a
  // confident number for a shot she is not in.
  const depth = projected.clone().sub(camera.position).dot(
    camera.getWorldDirection(new THREE.Vector3())
  );

  projected.project(camera);
  projectedTop.project(camera);
  const faceSize = Math.abs(projectedTop.y - projected.y) / 2;

  return {
    // NDC is -1..1; halved so these read as "fraction of the frame from the
    // centre", which is how the framing rules are written.
    x: projected.x / 2,
    y: projected.y / 2,
    faceSize,
    behindCamera: depth <= 0,
  };
}

// ---- Exposure ----
// A phone meters the whole frame and stops down when there is a lot of sky in
// it, which is exactly why a backlit face comes out dark. That behaviour is not
// faked here: the auto exposure really does read the rendered frame and chase a
// target average, so pointing the camera into the sun darkens her face for the
// same reason it does on a real phone, and the fix is the same one — hold the
// exposure up yourself.
const METER_SIZE = 48;            // px; a matrix meter does not need detail
// Both of these are in seconds rather than frames. A frame-counted meter
// settles at whatever rate the device happens to render at, which on a slow
// phone means the exposure is still crawling towards correct long after you
// have taken the picture.
const METER_PERIOD = 0.08;        // seconds between readings
const METER_TAU = 0.25;           // seconds; the exposure's time constant
const METER_TARGET = 0.42;        // mean luma the auto exposure aims for
const EXPOSURE_MIN = 0.25;
const EXPOSURE_MAX = 6.0;
const COMPENSATION_LIMIT = 2.0;   // EV, matching the range a phone slider gives

const meterCanvas = document.createElement('canvas');
meterCanvas.width = METER_SIZE;
meterCanvas.height = METER_SIZE;
const meterContext = meterCanvas.getContext('2d', { willReadFrequently: true });

let autoExposure = 1;
let exposureCompensation = 0;     // in stops, set by the player
let sinceMetered = 0;
let autoExposureEnabled = true;
let lastMeteredLuma = METER_TARGET;

// Compensation biases what the meter is aiming for, rather than multiplying
// what the meter produced. Written the other way round first, and it did not
// work: the auto exposure simply metered the brighter frame and pulled it back
// down, so +2 stops bought about half a stop. On a real camera the dial moves
// the target, and the meter then holds the picture there.
function meterTarget() {
  return METER_TARGET * Math.pow(2, exposureCompensation);
}

function applyExposure() {
  renderer.toneMappingExposure = THREE.MathUtils.clamp(autoExposure, EXPOSURE_MIN, EXPOSURE_MAX);
}

// Mean luma of whatever is on screen. Must run in the same tick as the render,
// like the photo capture, or it reads a cleared buffer.
function meanLuma() {
  meterContext.drawImage(renderer.domElement, 0, 0, METER_SIZE, METER_SIZE);
  const { data } = meterContext.getImageData(0, 0, METER_SIZE, METER_SIZE);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
  }
  return total / (data.length / 4);
}

function runAutoExposure(elapsed) {
  lastMeteredLuma = meanLuma();
  // Chase the target in exposure space rather than jumping to the ratio, so a
  // camera swing across the sun ramps the way a phone's does instead of
  // strobing. The ease is per second of real time, not per reading, so the
  // ramp takes the same quarter-second whatever the frame rate.
  const wanted = autoExposure * (meterTarget() / Math.max(lastMeteredLuma, 0.02));
  const ease = 1 - Math.exp(-elapsed / METER_TAU);
  autoExposure += (THREE.MathUtils.clamp(wanted, EXPOSURE_MIN, EXPOSURE_MAX) - autoExposure) * ease;
  applyExposure();
}

// Average brightness of the frame where her face is, which is what the photo
// is actually judged on. Sampled from the rendered frame rather than from the
// lighting model, so it accounts for the exposure the player chose.
function sampleFaceLuma(framing, canvas = renderer.domElement) {
  if (!framing || framing.behindCamera) return null;
  // framing.x/y are fractions of the frame from the centre; y is up in NDC and
  // down in canvas pixels.
  const centreX = (0.5 + framing.x) * canvas.width;
  const centreY = (0.5 - framing.y) * canvas.height;
  const box = Math.max(6, framing.faceSize * canvas.height * 0.7);
  const left = THREE.MathUtils.clamp(centreX - box / 2, 0, canvas.width - 1);
  const top = THREE.MathUtils.clamp(centreY - box / 2, 0, canvas.height - 1);
  const width = Math.min(box, canvas.width - left);
  const height = Math.min(box, canvas.height - top);
  if (width < 2 || height < 2) return null;

  meterContext.clearRect(0, 0, METER_SIZE, METER_SIZE);
  meterContext.drawImage(canvas, left, top, width, height, 0, 0, METER_SIZE, METER_SIZE);
  const { data } = meterContext.getImageData(0, 0, METER_SIZE, METER_SIZE);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
  }
  return total / (data.length / 4);
}

// Which way the light is coming from, as the photographer experiences it: the
// angle between the way the camera is pointing and the way the light travels.
// 0 means the sun is behind you and full on her face; 180 means you are
// shooting into it. Checked against the renderer rather than reasoned about —
// tools/measure_light.js shows her face at 0.55 at one end and 0.38 at the
// other, which is the right way round.
function lightAngleDegrees() {
  const toSubject = new THREE.Vector3(
    state.position.x - camera.position.x, 0, state.position.z - camera.position.z
  ).normalize();
  // From the sun towards the scene, which is the direction the light travels.
  const lightTravel = new THREE.Vector3(-sun.position.x, 0, -sun.position.z).normalize();
  return THREE.MathUtils.radToDeg(
    Math.acos(THREE.MathUtils.clamp(toSubject.dot(lightTravel), -1, 1))
  );
}

// A photo has to be taken in the same tick as the render that produced it: the
// drawing buffer is cleared between frames, so reading it any later hands back
// a blank canvas. The game asks here and gets the picture on the next frame.
let pendingShot = null;

function takePhoto(callback) {
  pendingShot = callback;
}

// A frame is kept as a canvas rather than as a JPEG. Encoding is the expensive
// half by a wide margin — a burst that encoded every frame ran at about three
// frames a second, which is not a burst, and worse, it sampled the dance in
// slow motion and sailed straight past the peak it was supposed to catch.
// Blitting to a canvas is a GPU copy and keeps the run at frame rate.
// Burst frames are scaled down; a single shot is not. Holding twelve
// full-size copies to choose between is a lot of memory for thumbnails.
// Burst frames are scaled down; a single shot is not. Twelve full-size copies
// held in memory to choose between is a lot for what are thumbnails.
const BURST_MAX_EDGE = 640;

function captureFrame({ measureLuma = true, maxEdge = Infinity } = {}) {
  const source = renderer.domElement;
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);

  const framing = measureFraming();
  return {
    canvas,
    state: window.__char.getState(),
    framing,
    // Reading pixels back off the GPU is the expensive part of all this, and a
    // burst frame does not need its brightness until it is the one chosen —
    // by which point it can be measured off the copy instead, which is cheap.
    faceLuma: measureLuma ? sampleFaceLuma(framing) : null,
    lightAngle: lightAngleDegrees(),
    reach: danceReach(),
    exposure: { auto: autoExposure, compensation: exposureCompensation },
  };
}

function encodeFrame(frame) {
  if (frame.faceLuma === null) frame.faceLuma = sampleFaceLuma(frame.framing, frame.canvas);
  if (!frame.dataUrl) frame.dataUrl = frame.canvas.toDataURL('image/jpeg', 0.85);
  return frame;
}

// A burst, the way a phone shoots a moving subject: hold it down, get a run of
// frames, keep the one that caught the moment.
//
// Both the spacing between frames and the run's length are measured in
// seconds, not in frames — the third time this lesson has come up in this
// file. A count tied to frames alone is a fifth of a second on a fast machine
// and seven seconds on a slow one, which is not the same photograph at all;
// this way a slow device gets fewer frames of the same slice of time rather
// than a different slice.
//
// The frame count is the player's choice (BURST_OPTIONS in game.js) and, at
// this fixed spacing, decides how long the burst runs: a short burst is a
// quick, easy-to-review handful of frames, a long one covers more time and
// forgives worse timing, at the cost of more frames to review afterward.
const BURST_SPACING = 0.05;
let burst = null;

function takeBurst(maxFrames, callback) {
  burst = {
    frames: [], callback, maxFrames, elapsed: 0, sinceFrame: Infinity,
    duration: maxFrames * BURST_SPACING,
  };
}

// Set by the test hooks so a screenshot can catch a moment that the real-time
// loop would otherwise have run straight past — the apex of a jump lasts about
// one frame, and the rAF loop lands her before the screenshot is taken.
let paused = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) step(dt);
  // The sun discs are flat circles; they only read as a sun while they face
  // the camera.
  sunDisc.lookAt(camera.position);
  sunGlow.lookAt(camera.position);
  renderer.render(scene, camera);

  // Both of these read the drawing buffer, so both belong here, after the
  // render that filled it and before the next frame clears it.
  if (pendingShot) {
    const deliver = pendingShot;
    pendingShot = null;
    deliver(encodeFrame(captureFrame()));
  }
  if (burst) {
    burst.elapsed += dt;
    burst.sinceFrame += dt;
    if (burst.sinceFrame >= BURST_SPACING && burst.frames.length < burst.maxFrames) {
      burst.sinceFrame = 0;
      burst.frames.push(captureFrame({ measureLuma: false, maxEdge: BURST_MAX_EDGE }));
    }
    if (burst.elapsed >= burst.duration || burst.frames.length >= burst.maxFrames) {
      const finished = burst;
      burst = null;
      finished.callback(finished.frames);
    }
  }
  if (!paused && autoExposureEnabled) {
    sinceMetered += dt;
    if (sinceMetered >= METER_PERIOD) {
      runAutoExposure(sinceMetered);
      sinceMetered = 0;
    }
  }
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__char = {
  ready: false,
  getState: () => ({
    animName: state.animName,
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    heading: state.heading,
    smile: Math.max(faceWeights.happy, faceWeights.relaxed),
    // Whichever managed expression is currently strongest, and how far it has
    // eased in — the pair a test needs to say "she is wearing this face".
    expression: MANAGED_EXPRESSIONS.reduce(
      (best, name) => (faceWeights[name] > faceWeights[best] ? name : best), MANAGED_EXPRESSIONS[0]
    ),
    expressionWeight: Math.max(...MANAGED_EXPRESSIONS.map((name) => faceWeights[name])),
    gazeAngle,
    gazeWeight,
  }),
  // The axis the eye bone points along, in world space, so a test can check
  // she is actually looking at the camera rather than that a number moved.
  // Only the axis is meaningful, not its sign: which end of the eye bone's
  // local +Z faces out of the face is up to whoever rigged the model, and on
  // this one it points backwards. Callers should compare with Math.abs.
  getEyeAim: () => {
    const eye = vrm && vrm.humanoid ? vrm.humanoid.getRawBoneNode('leftEye') : null;
    if (!eye) return null;
    eye.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3().setFromMatrixPosition(eye.matrixWorld);
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(eye.matrixWorld))
      .normalize();
    return {
      origin: { x: origin.x, y: origin.y, z: origin.z },
      forward: { x: forward.x, y: forward.y, z: forward.z },
    };
  },
  // Expression names the loaded model actually exposes — the previous model
  // shipped with this list empty, which is the bug that hid the missing
  // morph targets, so the tests assert on it now.
  getExpressions: () => (vrm && vrm.expressionManager
    ? vrm.expressionManager.expressions.map((e) => e.expressionName)
    : []),
  // World position of a humanoid bone, for poses that have to be checked
  // against real distances rather than eyeballed from a screenshot.
  //
  // Deliberately the *raw* bone, not the normalized one the pose code writes
  // to. The normalized rig is a rotation-only reference skeleton whose limb
  // segments do not carry the model's real bone lengths, so measuring it
  // reports every pose as putting the hand the same distance from the head —
  // which is exactly the wrong answer, and a confident-looking one.
  getBoneWorld: (name) => {
    const bone = vrm && vrm.humanoid ? vrm.humanoid.getRawBoneNode(name) : null;
    if (!bone) return null;
    bone.updateWorldMatrix(true, false);
    const v = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    return { x: v.x, y: v.y, z: v.z };
  },
  moveForTest: (direction, durationMs, run = false) => {
    const dirKeys = { forward: false, back: false, left: false, right: false };
    if (direction === 'forward') dirKeys.forward = true;
    else if (direction === 'back') dirKeys.back = true;
    else if (direction === 'left') dirKeys.left = true;
    else if (direction === 'right') dirKeys.right = true;

    Object.assign(keys, dirKeys, { run });
    const stepMs = 16;
    let elapsed = 0;
    while (elapsed < durationMs) {
      step(stepMs / 1000);
      elapsed += stepMs;
    }
    keys.forward = keys.back = keys.left = keys.right = keys.run = false;
    step(0.001);
    return window.__char.getState();
  },
  triggerActionForTest: (name, durationMs) => {
    keys.wave = name === 'wave';
    keys.crouch = name === 'crouch';
    keys.peace = name === 'peace';
    keys.doublePeace = name === 'double-peace';
    const stepMs = 16;
    let elapsed = 0;
    while (elapsed < durationMs) {
      step(stepMs / 1000);
      elapsed += stepMs;
    }
    keys.wave = false;
    keys.crouch = false;
    keys.peace = false;
    keys.doublePeace = false;
    step(0.001);
    return window.__char.getState();
  },
  // Like triggerActionForTest but leaves the pose held, so a caller can
  // measure it. triggerActionForTest releases the keys and steps once more
  // before returning, which lands the rig back in idle — measuring after it
  // silently reports the idle pose for every action.
  holdActionForTest: (name, durationMs) => {
    setPoseKeys(name);
    const stepMs = 16;
    let elapsed = 0;
    while (elapsed < durationMs) {
      step(stepMs / 1000);
      elapsed += stepMs;
    }
    return window.__char.getState();
  },
  releaseActionsForTest: () => {
    setPoseKeys('idle');
    step(0.001);
  },
  setPausedForTest: (on) => { paused = on; },
  // Freezes the auto exposure so a measurement can see the lighting on its own.
  // With it running, every frame is normalised to the same average and the
  // light direction looks like it makes no difference at all.
  setAutoExposureForTest: (on, value) => {
    autoExposureEnabled = on;
    if (value !== undefined) autoExposure = value;
    applyExposure();
  },
  // Where the sun actually ended up, so a light-direction measurement can be
  // checked against the thing itself rather than against the angle asked for.
  getSunForTest: () => ({ x: sun.position.x, y: sun.position.y, z: sun.position.z }),
  getScenarioForTest: () => (currentScenario ? {
    key: currentScenario.key,
    beatIndex,
    beat: currentScenario.beats[beatIndex],
    beatTimer,
  } : null),
  // Turns the director on as well: a scenario is a sequence of timed beats,
  // and runDirector -- the thing that advances them -- only runs while the
  // director has the strings. Starting one without it leaves her frozen on
  // beat zero forever.
  setCrouchArmOverrideForTest: (v) => { crouchArmOverride = v; },
  startScenarioForTest: (key) => { directorActive = true; return startScenario(key); },
  scenarioPeaksForTest: () => scenarioPeaks(),
  getBirdStateForTest: () => ({
    state: birdState, visible: bird.visible,
    position: { x: bird.position.x, y: bird.position.y, z: bird.position.z },
  }),
  // Lets a test hold her heading still. Only the gaze tests want this: they
  // put the camera at a known angle off her facing, which she would otherwise
  // turn to cancel out.
  setAutoFaceForTest: (on) => { autoFace = on; },
  // Any node by name, so secondary motion can be measured on bones the
  // humanoid map does not cover — hair tips and bust joints are spring bones,
  // not humanoid bones.
  getNodeWorld: (name) => {
    const node = vrm && vrm.scene ? vrm.scene.getObjectByName(name) : null;
    if (!node) return null;
    const v = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    return { x: v.x, y: v.y, z: v.z };
  },
  // A spring bone's offset from its anchor, expressed in the anchor's own
  // frame. Measuring in world space instead would count the body's own turning
  // as swing — the chest rotates as she runs, which moves the bust joints in
  // world space even with the springs perfectly rigid.
  getSpringOffsetForTest: (nodeName, anchorBoneName) => {
    const node = vrm && vrm.scene ? vrm.scene.getObjectByName(nodeName) : null;
    const anchor = vrm && vrm.humanoid ? vrm.humanoid.getRawBoneNode(anchorBoneName) : null;
    if (!node || !anchor) return null;
    anchor.updateWorldMatrix(true, false);
    const offset = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld))
      .applyQuaternion(
        new THREE.Quaternion().setFromRotationMatrix(anchor.matrixWorld).invert()
      );
    return { x: offset.x, y: offset.y, z: offset.z };
  },
  getSpringSettings: () => {
    if (!vrm || !vrm.springBoneManager) return [];
    return [...vrm.springBoneManager.joints].map((joint) => ({
      bone: joint.bone.name,
      dragForce: joint.settings.dragForce,
      stiffness: joint.settings.stiffness,
    }));
  },
  // Where the camera actually is, so a test can check she is facing it rather
  // than checking her heading against where the camera was put — the follow
  // camera moves with her, so those are not the same question.
  getCameraPosition: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  // Park the camera for a screenshot. Goes through OrbitControls' target
  // rather than camera.lookAt so the next controls.update() doesn't undo it.
  setCameraForTest: (position, target) => {
    camera.position.set(position.x, position.y, position.z);
    controls.target.set(target.x, target.y, target.z);
    controls.update();
  },
  jumpForTest: (durationMs) => {
    startJump();
    const stepMs = 16;
    let elapsed = 0;
    const samples = [];
    while (elapsed < durationMs) {
      step(stepMs / 1000);
      elapsed += stepMs;
      samples.push(window.__char.getState().position.y);
    }
    return { ...window.__char.getState(), maxHeight: Math.max(...samples) };
  },
};
