// Standalone studio-lit viewer for a single VRM or GLB file, decoupled from
// the game (src/main.js) so a raw model export can be judged on its own —
// no toon-shading pass, no game camera rig, no wardrobe/scene systems.
//
// Query params: ?model=assets/char-a.vrm (default: assets/char-a.vrm)
// A .vrm path loads through the VRM loader plugin (humanoid pose reset,
// MToon materials as authored); any other extension (.glb/.gltf) loads
// through plain GLTFLoader, for files that never carried the VRM extension
// (e.g. a Blender glTF export) — that model is shown in whatever pose/bind
// it was exported in.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const statusEl = document.getElementById('status');
const params = new URLSearchParams(location.search);
const modelUrl = params.get('model') || 'assets/char-a.vrm';
const isVrm = /\.vrm($|\?)/i.test(modelUrl);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(900, 1200);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a32);

const camera = new THREE.PerspectiveCamera(32, 900 / 1200, 0.05, 20);

// Seamless-ish studio floor: a large soft-shadowed plane a hair below the
// model's feet, dim enough not to compete with her.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.ShadowMaterial({ opacity: 0.35 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Three-point rig: key (main, casts the shadow), fill (soft, no shadow, low
// intensity so it lifts without flattening), rim (behind/above, separates
// her silhouette from the background). Plus a low-intensity hemisphere so
// unlit-facing surfaces are never pure black.
const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
key.position.set(1.4, 2.2, 1.8);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 8;
key.shadow.camera.left = -1.2;
key.shadow.camera.right = 1.2;
key.shadow.camera.top = 2;
key.shadow.camera.bottom = -0.2;
key.shadow.bias = -0.0015;
scene.add(key);

const fill = new THREE.DirectionalLight(0xdce8ff, 0.9);
fill.position.set(-1.8, 1.4, 1.2);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 1.3);
rim.position.set(-0.6, 2.4, -2.0);
scene.add(rim);

const hemi = new THREE.HemisphereLight(0x8892a8, 0x1c1c22, 0.55);
scene.add(hemi);

const loader = new GLTFLoader();
if (isVrm) loader.register((parser) => new VRMLoaderPlugin(parser));

window.__preview = { ready: false };

function frameCamera(root, kind) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const height = size.y || 1.6;
  const topY = box.max.y;

  if (kind === 'face') {
    const y = topY - height * 0.10;
    camera.position.set(0, y, 0.55);
    camera.lookAt(0, y, 0);
  } else if (kind === 'threeQuarter') {
    const y = center.y;
    camera.position.set(0.85, y + height * 0.05, 1.1);
    camera.lookAt(0, center.y, 0);
  } else if (kind === 'bust') {
    const y = topY - height * 0.14;
    camera.position.set(0, y, 0.95);
    camera.lookAt(0, y - height * 0.04, 0);
  } else {
    // full body, front
    const y = center.y;
    camera.position.set(0, y + height * 0.05, height * 1.9);
    camera.lookAt(0, center.y - height * 0.02, 0);
  }
  camera.updateProjectionMatrix();
}

let root = null;

window.__preview.setShotForTest = (kind) => {
  if (root) frameCamera(root, kind);
};

function render() {
  renderer.render(scene, camera);
}
window.__preview.render = render;

loader.load(
  modelUrl,
  (gltf) => {
    root = gltf.scene;
    if (isVrm && gltf.userData.vrm) {
      const vrm = gltf.userData.vrm;
      VRMUtils.rotateVRM0(vrm);
      if (vrm.humanoid) {
        vrm.humanoid.resetNormalizedPose();
        // resetNormalizedPose() lands on three-vrm's canonical T-pose (that's
        // what "normalized" means for retargeting), not a natural standing
        // pose — bring the arms down to the sides the same way the game's own
        // base pose does (src/main.js, ARM_DOWN_Z = -1.3), so a static preview
        // reads as "a person standing" rather than "a person being measured".
        // Sign empirically checked by rendering: main.js's own ARM_DOWN_Z=-1.3
        // on leftUpperArm swings the arm UP here, not down — this file's
        // normalized rig apparently mirrors main.js's assumption (see its own
        // `rigIsMirrored` flag), so the working sign is the opposite one.
        const ARM_DOWN_Z = 1.3;
        const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (left) left.rotation.set(0, 0, ARM_DOWN_Z);
        if (right) right.rotation.set(0, 0, -ARM_DOWN_Z);
        // Normalized-bone edits only reach the actual skinned mesh through
        // vrm.update() (it syncs normalized -> raw bones, same as the game's
        // own render loop does every frame at src/main.js:2973) — skip it and
        // the mesh keeps rendering the unmodified T-pose.
        vrm.update(0);
      }
      root = vrm.scene;
    }
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    scene.add(root);
    frameCamera(root, 'full');
    render();
    statusEl.textContent = modelUrl;
    window.__preview.ready = true;
  },
  undefined,
  (err) => {
    statusEl.textContent = 'ERROR: ' + (err && err.message ? err.message : String(err));
    console.error(err);
    window.__preview.ready = 'error';
  }
);
