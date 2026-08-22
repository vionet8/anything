import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { initPhotoGame } from './game.js';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd9e8, 28, 75);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

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

const keys = { forward: false, back: false, left: false, right: false, run: false, wave: false, crouch: false, peace: false, doublePeace: false };

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

function onKey(e, down) {
  const expression = FACE_KEYS[e.code];
  if (expression) {
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
      keys.wave = down;
      break;
    case 'KeyC':
      keys.crouch = down;
      break;
    case 'KeyV':
      keys.peace = down;
      break;
    case 'KeyB':
      keys.doublePeace = down;
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

const stateLabel = document.getElementById('anim-state');

function setAnimName(name) {
  if (state.animName === name) return;
  state.animName = name;
  if (stateLabel) {
    stateLabel.textContent = 'state: ' + name;
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

function calmSpringBones() {
  if (!vrm || !vrm.springBoneManager) return 0;
  let adjusted = 0;
  for (const joint of vrm.springBoneManager.joints) {
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

const loader = new GLTFLoader();
loader.register(cspSafeTextures);
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(
  'assets/girl.vrm',
  (gltf) => {
    vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm); // no-op for VRM1 models, safe either way
    modelYaw = vrm.scene.rotation.y;
    rigIsMirrored = modelYaw !== 0;
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
      'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
      'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
      'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
      'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
      'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
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

    // Hand the eyes a target to follow. autoUpdate means VRM re-reads its
    // world position on every vrm.update(), so applyGaze only has to move it.
    if (vrm.lookAt) vrm.lookAt.target = gazeTarget;

    calmSpringBones();

    state.ready = true;
    window.__char.ready = true;

    initPhotoGame({
      getState: () => window.__char.getState(),
      measureFraming,
      takePhoto,
      setPose: (name) => {
        keys.wave = name === 'wave';
        keys.crouch = name === 'crouch';
        keys.peace = name === 'peace';
        keys.doublePeace = name === 'double-peace';
      },
      setExpression: (name) => { heldExpression = name; },
    });
  },
  undefined,
  (err) => {
    console.error('Failed to load VRM character', err);
  }
);

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

function applyGaze(dt) {
  const rawHead = vrm.humanoid.getRawBoneNode('head');
  if (!rawHead) return;
  rawHead.updateWorldMatrix(true, false);
  gazeHeadPos.setFromMatrixPosition(rawHead.matrixWorld);

  gazeToCamera.copy(camera.position).sub(gazeHeadPos);
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
  const rise = (camera.position.y - gazeHeadPos.y) * gazeWeight * (GAZE_TARGET_DISTANCE / horizontal);
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
    else applyIdle(dt);
  }

  applyGaze(dt);
  conformPoseToRig();
  applyFace(dt, action);

  vrm.update(dt);
  updateCamera();
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

// A photo has to be taken in the same tick as the render that produced it: the
// drawing buffer is cleared between frames, so reading it any later hands back
// a blank canvas. The game asks here and gets the picture on the next frame.
let pendingShot = null;

function takePhoto(callback) {
  pendingShot = callback;
}

// Set by the test hooks so a screenshot can catch a moment that the real-time
// loop would otherwise have run straight past — the apex of a jump lasts about
// one frame, and the rAF loop lands her before the screenshot is taken.
let paused = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) step(dt);
  renderer.render(scene, camera);
  if (pendingShot) {
    const deliver = pendingShot;
    pendingShot = null;
    deliver({
      dataUrl: renderer.domElement.toDataURL('image/jpeg', 0.85),
      state: window.__char.getState(),
      framing: measureFraming(),
    });
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
    return window.__char.getState();
  },
  releaseActionsForTest: () => {
    keys.wave = keys.crouch = keys.peace = keys.doublePeace = false;
    step(0.001);
  },
  setPausedForTest: (on) => { paused = on; },
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
