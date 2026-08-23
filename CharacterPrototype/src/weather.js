// Weather, as something that happens to her rather than as a filter over the
// picture.
//
// The bird was the first of these: a thing in the world that gives her a
// reason to do something. Wind and rain are the other two. Each one is an
// *episode* -- it arrives, it is the reason for a beat or two, and it goes --
// which is also why none of them is on all the time.
//
// This module owns the particles and the numbers. What she does about them is
// in main.js, because that is where her body is.
import * as THREE from 'three';

function makeSoftTexture(draw) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function petalTexture() {
  return makeSoftTexture((ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    // An ellipse rather than a disc: at this size the only thing that reads is
    // the aspect, and a round speck reads as dust while a long one reads as a
    // petal going past.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(1, 0.55);
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

const PETAL_COUNT = 420;
const RAIN_COUNT = 900;

// Both systems live in a box that travels with the camera horizontally.
// Filling the whole 60-metre scene with rain would be most of the particles
// falling somewhere nobody is looking; a box around the viewer is the same
// picture for a fraction of the count.
//
// Horizontally only. Wrapping the vertical axis around the camera as well --
// which is what this did first -- puts the bottom of the weather at eye
// height, so the rain stopped dead at her chest and every petal blew past
// above the frame. Height is measured from the ground, like weather is.
const FIELD = { x: 11, y: 8, z: 11 };

export function createWeather(scene) {
  const state = {
    wind: 0,            // 0..1, how hard it is blowing
    windTarget: 0,
    windDirection: 0,   // radians, the bearing it blows toward
    rain: 0,            // 0..1, how hard it is raining
    rainTarget: 0,
    gust: 0,            // fast flutter on top of the steady wind
    time: 0,
  };

  // ---- Petals on the wind ----
  const petalGeo = new THREE.BufferGeometry();
  const petalPos = new Float32Array(PETAL_COUNT * 3);
  const petalSeed = new Float32Array(PETAL_COUNT);
  for (let i = 0; i < PETAL_COUNT; i++) {
    petalPos[i * 3] = (Math.random() - 0.5) * FIELD.x;
    petalPos[i * 3 + 1] = Math.random() * FIELD.y;
    petalPos[i * 3 + 2] = (Math.random() - 0.5) * FIELD.z;
    petalSeed[i] = Math.random() * Math.PI * 2;
  }
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  const petals = new THREE.Points(petalGeo, new THREE.PointsMaterial({
    size: 0.19,
    map: petalTexture(),
    color: 0xf7d6e2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  }));
  petals.frustumCulled = false;
  petals.visible = false;
  scene.add(petals);

  // ---- Rain ----
  // Line segments, not points: rain is a streak, and a round dot at this
  // scale looks like snow.
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 6);
  const rainSpeed = new Float32Array(RAIN_COUNT);
  for (let i = 0; i < RAIN_COUNT; i++) {
    const x = (Math.random() - 0.5) * FIELD.x;
    const y = Math.random() * FIELD.y;
    const z = (Math.random() - 0.5) * FIELD.z;
    rainSpeed[i] = 14 + Math.random() * 10;
    rainPos[i * 6] = x;
    rainPos[i * 6 + 1] = y;
    rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x;
    rainPos[i * 6 + 4] = y - 0.42;
    rainPos[i * 6 + 5] = z;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
    color: 0xc8dae6, transparent: true, opacity: 0, depthWrite: false,
  }));
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  // Splashes where it lands: a ring of flat discs that pop and fade. Rain
  // that passes through the ground and vanishes reads as a screen effect.
  const SPLASH_COUNT = 40;
  const splashGeo = new THREE.RingGeometry(0.03, 0.075, 8);
  const splashMat = new THREE.MeshBasicMaterial({
    color: 0xdceaf2, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const splashes = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_COUNT);
  splashes.frustumCulled = false;
  splashes.visible = false;
  splashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const splashLife = new Float32Array(SPLASH_COUNT);
  const splashAt = [];
  for (let i = 0; i < SPLASH_COUNT; i++) {
    splashLife[i] = Math.random();
    splashAt.push(new THREE.Vector3());
  }
  scene.add(splashes);
  const splashMatrix = new THREE.Matrix4();
  const splashScale = new THREE.Vector3();
  const splashQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  function wrap(value, half) {
    if (value > half) return value - half * 2;
    if (value < -half) return value + half * 2;
    return value;
  }

  function updatePetals(dt, centre) {
    const strength = state.wind;
    petals.visible = strength > 0.01;
    petals.material.opacity = Math.min(0.85, strength * 1.1);
    if (!petals.visible) return;

    const speed = 1.4 + strength * 7;
    const dx = Math.sin(state.windDirection) * speed * dt;
    const dz = Math.cos(state.windDirection) * speed * dt;
    const position = petalGeo.attributes.position;
    for (let i = 0; i < PETAL_COUNT; i++) {
      const seed = petalSeed[i];
      let x = position.getX(i) - centre.x + dx;
      let y = position.getY(i);
      let z = position.getZ(i) - centre.z + dz;
      // Petals do not travel in straight lines; they tumble.
      y += Math.sin(state.time * 2.1 + seed) * dt * 1.1 - dt * 0.55;
      x += Math.cos(state.time * 1.7 + seed) * dt * 0.9;
      if (y < 0.05) y += FIELD.y;
      if (y > FIELD.y) y -= FIELD.y;
      position.setXYZ(i,
        wrap(x, FIELD.x / 2) + centre.x,
        y,
        wrap(z, FIELD.z / 2) + centre.z);
    }
    position.needsUpdate = true;
  }

  function updateRain(dt, centre) {
    const amount = state.rain;
    rain.visible = amount > 0.01;
    splashes.visible = rain.visible;
    rain.material.opacity = Math.min(0.55, amount * 0.6);
    if (!rain.visible) return;

    // Rain leans with the wind, which is the only thing that ties the two
    // together visually when they happen at once.
    const leanX = Math.sin(state.windDirection) * state.wind * 0.5;
    const leanZ = Math.cos(state.windDirection) * state.wind * 0.5;
    const position = rainGeo.attributes.position;
    const array = position.array;
    const visible = Math.floor(RAIN_COUNT * Math.min(1, amount * 1.2));
    for (let i = 0; i < RAIN_COUNT; i++) {
      const head = i * 6;
      if (i >= visible) {
        // Parked below the ground rather than deleted, so the count can move
        // without rebuilding the buffer.
        array[head + 1] = -50;
        array[head + 4] = -50.4;
        continue;
      }
      const fall = rainSpeed[i] * dt;
      let y = array[head + 1] - fall;
      let x = array[head] - centre.x + leanX * fall;
      let z = array[head + 2] - centre.z + leanZ * fall;
      if (y < 0) {
        y += FIELD.y;
        x = (Math.random() - 0.5) * FIELD.x;
        z = (Math.random() - 0.5) * FIELD.z;
      }
      array[head] = x + centre.x;
      array[head + 1] = y;
      array[head + 2] = z + centre.z;
      array[head + 3] = x + centre.x - leanX * 0.42;
      array[head + 4] = y - 0.42;
      array[head + 5] = z + centre.z - leanZ * 0.42;
    }
    position.needsUpdate = true;

    for (let i = 0; i < SPLASH_COUNT; i++) {
      splashLife[i] += dt * (2.6 + amount * 1.6);
      if (splashLife[i] >= 1) {
        splashLife[i] -= 1;
        splashAt[i].set(
          centre.x + (Math.random() - 0.5) * 7,
          0.02,
          centre.z + (Math.random() - 0.5) * 7
        );
      }
      const t = splashLife[i];
      const scale = 0.4 + t * 2.6;
      splashScale.set(scale, scale, scale);
      splashMatrix.compose(splashAt[i], splashQuat, splashScale);
      splashes.setMatrixAt(i, splashMatrix);
    }
    splashes.instanceMatrix.needsUpdate = true;
    splashMat.opacity = (1 - 0.5) * 0.5 * amount;
  }

  return {
    state,
    setWind(target, direction) {
      state.windTarget = THREE.MathUtils.clamp(target, 0, 1);
      if (direction !== undefined) state.windDirection = direction;
    },
    setRain(target) {
      state.rainTarget = THREE.MathUtils.clamp(target, 0, 1);
    },
    // Weather does not switch on. It builds and it dies away, and the ramp is
    // what a scenario's first beat is reacting to.
    update(dt, centre) {
      state.time += dt;
      state.wind += (state.windTarget - state.wind) * Math.min(1, dt * 0.9);
      state.rain += (state.rainTarget - state.rain) * Math.min(1, dt * 0.7);
      // The gust is what makes wind feel like weather rather than a fan: the
      // steady part is the target, this is the part that comes and goes.
      state.gust = state.wind * (0.72 + 0.28 * Math.sin(state.time * 1.9)
        + 0.18 * Math.sin(state.time * 4.7 + 1.3));
      updatePetals(dt, centre);
      updateRain(dt, centre);
    },
    reset() {
      state.wind = state.windTarget = 0;
      state.rain = state.rainTarget = 0;
      petals.visible = false;
      rain.visible = false;
      splashes.visible = false;
    },
  };
}
