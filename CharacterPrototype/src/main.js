import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202030);
scene.fog = new THREE.Fog(0x202030, 20, 60);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.2);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(8, 15, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x2f3a2f })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(80, 40, 0x444444, 0x333333);
scene.add(grid);

const MOVE_SPEED = 4.2; // units/sec, walk
const RUN_SPEED = 8.5; // units/sec, run (shift held)

const state = {
  ready: false,
  animName: 'idle',
  position: new THREE.Vector3(0, 0, 0),
  heading: 0, // radians
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

let character = null;
let mixer = null;
let actions = {};
let currentAction = null;

function setAnimation(name) {
  if (state.animName === name || !actions[name]) return;
  const next = actions[name];
  const prev = currentAction;
  next.reset().fadeIn(0.2).play();
  if (prev) prev.fadeOut(0.2);
  currentAction = next;
  state.animName = name;
  document.getElementById('anim-state').textContent = 'state: ' + name;
}

const loader = new GLTFLoader();
loader.load(
  'assets/Soldier.glb',
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
    for (const clip of gltf.animations) {
      actions[clip.name] = mixer.clipAction(clip);
    }

    // Soldier.glb ships with clips named "Idle", "Walk", "Run", "TPose".
    // Normalize to lowercase keys so the rest of the app doesn't care about
    // the exact casing baked into this particular asset.
    const normalized = {};
    for (const [name, action] of Object.entries(actions)) {
      normalized[name.toLowerCase()] = action;
    }
    actions = normalized;

    if (actions.idle) {
      currentAction = actions.idle;
      currentAction.play();
      state.animName = 'idle';
    }

    state.ready = true;
    window.__char.ready = true;
  },
  undefined,
  (err) => {
    console.error('Failed to load character model', err);
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

// Test-facing hook, same philosophy as the web-game-harness skill: expose a
// deterministic, non-realtime way to drive the character so Playwright tests
// don't have to hold down real keys for real wall-clock seconds.
window.__char = {
  ready: false,
  getState: () => ({
    animName: state.animName,
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    heading: state.heading,
  }),
  // Simulates holding a direction for durationMs of simulated time, in
  // discrete steps, without waiting on real wall-clock time.
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
