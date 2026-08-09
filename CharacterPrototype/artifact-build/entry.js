import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0c0e14, 22, 62);

const canvas = document.getElementById('scene');
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const hemi = new THREE.HemisphereLight(0xaebfe0, 0x1a1d26, 1.1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffe8c2, 1.9);
sun.position.set(8, 15, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.95 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(80, 40, 0x3a3f4f, 0x262a35);
grid.position.y = 0.01;
scene.add(grid);

const MOVE_SPEED = 4.2;
const RUN_SPEED = 8.5;

const state = {
  ready: false,
  animName: 'idle',
  position: new THREE.Vector3(0, 0, 0),
  heading: 0,
};

const keys = { forward: false, back: false, left: false, right: false, run: false };

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
  }
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));

// Touch controls for mobile: tap-and-hold the pad to walk forward.
const touchPad = document.getElementById('touch-pad');
if (touchPad) {
  const setTouch = (on) => {
    keys.forward = on;
  };
  touchPad.addEventListener('touchstart', (e) => { e.preventDefault(); setTouch(true); }, { passive: false });
  touchPad.addEventListener('touchend', (e) => { e.preventDefault(); setTouch(false); }, { passive: false });
  touchPad.addEventListener('touchcancel', () => setTouch(false));
}

let character = null;
let mixer = null;
let actions = {};
let currentAction = null;

const stateLabel = document.getElementById('state-label');
const loadingEl = document.getElementById('loading');

function setAnimation(name) {
  if (state.animName === name || !actions[name]) return;
  const next = actions[name];
  const prev = currentAction;
  next.reset().fadeIn(0.2).play();
  if (prev) prev.fadeOut(0.2);
  currentAction = next;
  state.animName = name;
  if (stateLabel) {
    stateLabel.textContent = name;
    stateLabel.dataset.state = name;
  }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const loader = new GLTFLoader();
const modelBuffer = base64ToArrayBuffer(window.__MODEL_BASE64__);

loader.parse(
  modelBuffer,
  '',
  (gltf) => {
    character = gltf.scene;
    character.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    scene.add(character);

    mixer = new THREE.AnimationMixer(character);
    const rawActions = {};
    for (const clip of gltf.animations) {
      rawActions[clip.name.toLowerCase()] = mixer.clipAction(clip);
    }
    actions = rawActions;

    if (actions.idle) {
      currentAction = actions.idle;
      currentAction.play();
      state.animName = 'idle';
    }

    state.ready = true;
    window.__char.ready = true;
    if (loadingEl) loadingEl.style.display = 'none';
  },
  (err) => {
    console.error('Failed to parse character model', err);
    if (loadingEl) loadingEl.textContent = 'モデルの読み込みに失敗しました';
  }
);

camera.position.set(0, 3.2, -6);

function updateCamera() {
  const behind = new THREE.Vector3(
    Math.sin(state.heading) * -6,
    3.2,
    Math.cos(state.heading) * -6
  );
  const target = state.position.clone().add(behind);
  camera.position.lerp(target, 0.12);
  const lookAt = state.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  camera.lookAt(lookAt);
}

const clock = new THREE.Clock();

function step(dt) {
  if (!character) return;

  let moveX = 0;
  let moveZ = 0;
  if (keys.forward) moveZ += 1;
  if (keys.back) moveZ -= 1;
  if (keys.left) moveX -= 1;
  if (keys.right) moveX += 1;

  const moving = moveX !== 0 || moveZ !== 0;

  if (moving) {
    const targetHeading = Math.atan2(moveX, moveZ);
    state.heading = targetHeading;
    character.rotation.y = state.heading;

    const speed = keys.run ? RUN_SPEED : MOVE_SPEED;
    const dir = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    state.position.addScaledVector(dir, speed * dt);
    character.position.copy(state.position);

    setAnimation(keys.run ? 'run' : 'walk');
  } else {
    setAnimation('idle');
  }

  if (mixer) mixer.update(dt);
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
    setAnimation('idle');
    return window.__char.getState();
  },
};
