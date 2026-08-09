import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

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
const MOVE_SPEED = 3.6;
const RUN_SPEED = 7.4;

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

const stateLabel = document.getElementById('anim-state');

function setAnimName(name) {
  if (state.animName === name) return;
  state.animName = name;
  if (stateLabel) stateLabel.textContent = 'state: ' + name;
}

let vrm = null;
let bones = {};
let walkCycle = 0;

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(
  'assets/girl.vrm',
  (gltf) => {
    vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm);
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
      'leftUpperArm', 'leftLowerArm',
      'rightUpperArm', 'rightLowerArm',
      'leftUpperLeg', 'leftLowerLeg',
      'rightUpperLeg', 'rightLowerLeg',
    ];
    for (const name of names) {
      bones[name] = vrm.humanoid.getNormalizedBoneNode(name);
    }

    state.ready = true;
    window.__char.ready = true;
  },
  undefined,
  (err) => {
    console.error('Failed to load VRM character', err);
  }
);

camera.position.set(0, 3.0, -5.5);

function updateCamera() {
  const behind = new THREE.Vector3(Math.sin(state.heading) * -5.5, 3.0, Math.cos(state.heading) * -5.5);
  const target = state.position.clone().add(behind);
  camera.position.lerp(target, 0.12);
  const lookAt = state.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  camera.lookAt(lookAt);
}

// ---- Procedural locomotion ----
// This VRM avatar ships with a humanoid skeleton but no animation clips
// (unlike Mixamo-style rigs), so idle/walk/run are hand-authored bone
// rotations applied every frame rather than played from baked clips.
const ARM_DOWN_Z = -1.3;

function applyPose(moving, running, dt) {
  if (!bones.hips) return;

  bones.leftUpperArm.rotation.z = ARM_DOWN_Z;
  bones.rightUpperArm.rotation.z = -ARM_DOWN_Z;

  const freq = running ? 9.0 : 6.0;
  const legAmp = running ? 0.9 : 0.55;
  const armAmp = running ? 0.7 : 0.4;
  const bounceAmp = running ? 0.09 : 0.035;

  if (moving) {
    walkCycle += dt * freq;
  } else {
    walkCycle += dt * 2.0;
  }

  const swing = Math.sin(walkCycle);
  const targetLeg = moving ? legAmp : 0;
  const targetArm = moving ? armAmp : 0;
  const targetBounce = moving ? bounceAmp : 0;

  bones.leftUpperLeg.rotation.x = swing * targetLeg;
  bones.rightUpperLeg.rotation.x = -swing * targetLeg;
  bones.leftLowerLeg.rotation.x = Math.max(0, -swing) * targetLeg * 0.9;
  bones.rightLowerLeg.rotation.x = Math.max(0, swing) * targetLeg * 0.9;

  bones.leftUpperArm.rotation.x = -swing * targetArm;
  bones.rightUpperArm.rotation.x = swing * targetArm;

  bones.hips.position.y = Math.abs(Math.sin(walkCycle * 2)) * targetBounce;
  bones.chest.rotation.x = moving ? 0.05 + (running ? 0.08 : 0) : Math.sin(walkCycle * 0.6) * 0.015;
  bones.head.rotation.y = moving ? 0 : Math.sin(walkCycle * 0.35) * 0.05;

  setAnimName(!moving ? 'idle' : running ? 'run' : 'walk');
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

  if (moving) {
    state.heading = Math.atan2(moveX, moveZ);
    vrm.scene.rotation.y = state.heading;

    const speed = running ? RUN_SPEED : MOVE_SPEED;
    const dir = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    state.position.addScaledVector(dir, speed * dt);
    vrm.scene.position.copy(state.position);
  }

  applyPose(moving, running, dt);
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
};
