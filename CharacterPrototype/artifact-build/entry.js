import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const canvas = document.getElementById('scene');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd9e8, 28, 75);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

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
const hemi = new THREE.HemisphereLight(0xdff0ff, 0x6b8f5a, 1.15);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff3d6, 2.0);
sun.position.set(10, 18, 6);
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

const keys = { forward: false, back: false, left: false, right: false, run: false, wave: false, crouch: false, peace: false };

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

function onKey(e, down) {
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
      keys.wave = down;
      break;
    case 'KeyC':
      keys.crouch = down;
      break;
    case 'KeyV':
      keys.peace = down;
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

const stateLabel = document.getElementById('state-label');
const loadingEl = document.getElementById('loading');

function setAnimName(name) {
  if (state.animName === name) return;
  state.animName = name;
  if (stateLabel) {
    stateLabel.textContent = name;
    stateLabel.dataset.state = name;
  }
}

let vrm = null;
let bones = {};
let hipsBaseY = 0;

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

const modelBuffer = base64ToArrayBuffer(window.__MODEL_BASE64__);

loader.parse(
  modelBuffer,
  '',
  (gltf) => {
    vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm); // no-op for VRM1 models, safe either way
    vrm.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
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
    ];
    for (const name of names) {
      bones[name] = vrm.humanoid.getNormalizedBoneNode(name);
    }

    // The normalized hips bone's own rest position already encodes standing
    // pelvis height above the ground (feet are at the model's local y=0, hips
    // are not) — capture it so pose code can offset FROM it instead of
    // overwriting it with world-origin (0,0,0), which was collapsing her
    // pelvis reference down to ground level and sinking the whole lower body.
    hipsBaseY = bones.hips.position.y;

    state.ready = true;
    window.__char.ready = true;
    if (loadingEl) loadingEl.style.display = 'none';
  },
  (err) => {
    console.error('Failed to load VRM character', err);
    if (loadingEl) loadingEl.textContent = 'モデルの読み込みに失敗しました';
  }
);

// ---- Camera: orbit around the character, drag to look from any angle ----
// (this is also how you can actually see her face — the old fixed
// behind-the-back follow camera never showed it).
camera.position.set(0, 2.6, -4.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
controls.minDistance = 1.8;
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
  // for applyPeace to only touch the fingers it needs to curl.
  bones.rightThumbMetacarpal.rotation.set(0, 0, 0);
  bones.rightThumbProximal.rotation.set(0, 0, 0);
  bones.rightThumbDistal.rotation.set(0, 0, 0);
  bones.rightIndexProximal.rotation.set(0, 0, 0);
  bones.rightIndexIntermediate.rotation.set(0, 0, 0);
  bones.rightIndexDistal.rotation.set(0, 0, 0);
  bones.rightMiddleProximal.rotation.set(0, 0, 0);
  bones.rightMiddleIntermediate.rotation.set(0, 0, 0);
  bones.rightMiddleDistal.rotation.set(0, 0, 0);
  bones.rightRingProximal.rotation.set(0, 0, 0);
  bones.rightRingIntermediate.rotation.set(0, 0, 0);
  bones.rightRingDistal.rotation.set(0, 0, 0);
  bones.rightLittleProximal.rotation.set(0, 0, 0);
  bones.rightLittleIntermediate.rotation.set(0, 0, 0);
  bones.rightLittleDistal.rotation.set(0, 0, 0);
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
  bones.chest.rotation.y = -0.05;
  bones.head.rotation.y = -0.06;
  setAnimName('wave');
}

function applyPeace(dt) {
  actionCycle += dt * 1.2;
  // Reuses the wave's verified raised-arm formula (elbow below shoulder,
  // palm rolled to face the viewer via the hand's local X) — same shoulder
  // height reads fine for a held-up peace sign, just without the wrist
  // swing. The finger curl axis (Y) was found by isolating one bone at a
  // time and reading whether the fingertip stayed visible from a
  // palm-facing camera or vanished behind the palm — confirmed on both the
  // little finger alone and then the ring finger + thumb together before
  // trusting it. Index and middle are left at their already-open rest pose.
  bones.rightUpperArm.rotation.set(-1.8, -0.4, -0.5);
  bones.rightLowerArm.rotation.set(0.1, 1.7, 0);
  bones.rightHand.rotation.set(-1.0, 0, 0);
  bones.rightRingProximal.rotation.set(0, 0.9, 0);
  bones.rightRingIntermediate.rotation.set(0, 0.9, 0);
  bones.rightRingDistal.rotation.set(0, 0.9, 0);
  bones.rightLittleProximal.rotation.set(0, 0.9, 0);
  bones.rightLittleIntermediate.rotation.set(0, 0.9, 0);
  bones.rightLittleDistal.rotation.set(0, 0.9, 0);
  bones.rightThumbProximal.rotation.set(0, 0.9, 0);
  bones.rightThumbDistal.rotation.set(0, 0.9, 0);
  bones.chest.rotation.y = -0.05;
  bones.head.rotation.y = -0.06;
  bones.head.rotation.x = Math.sin(actionCycle * 0.6) * 0.015; // subtle breathing, not a stiff freeze
  setAnimName('peace');
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

const clock = new THREE.Clock();

function step(dt) {
  if (!vrm) return;

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
    : keys.wave ? 'wave' : keys.crouch ? 'crouch' : keys.peace ? 'peace' : 'idle';

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
    vrm.scene.rotation.y = state.heading;

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
  } else if (landingRecoverT > 0) {
    applyLanding();
  } else if (keys.wave) {
    applyWave(dt);
  } else if (keys.crouch) {
    applyCrouch(dt);
  } else if (keys.peace) {
    applyPeace(dt);
  } else {
    // Face the camera when idle, instead of staying turned wherever the
    // last movement left her — this is what actually lets you see her
    // face without fighting the camera.
    const toCam = new THREE.Vector2(camera.position.x - state.position.x, camera.position.z - state.position.z);
    if (toCam.lengthSq() > 0.0001) {
      const targetFacing = Math.atan2(toCam.x, toCam.y);
      let delta = targetFacing - facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest-path wrap
      facing += delta * Math.min(1, dt * 3.0);
      vrm.scene.rotation.y = facing;
      state.heading = facing;
    }
    applyIdle(dt);
  }

  vrm.update(dt);
  updateCamera();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  step(dt);
  renderer.render(scene, camera);
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
  }),
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
    const stepMs = 16;
    let elapsed = 0;
    while (elapsed < durationMs) {
      step(stepMs / 1000);
      elapsed += stepMs;
    }
    keys.wave = false;
    keys.crouch = false;
    keys.peace = false;
    step(0.001);
    return window.__char.getState();
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
