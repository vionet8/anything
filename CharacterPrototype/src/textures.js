// Procedurally drawn textures.
//
// Everything here is painted into a canvas at load and handed to three.js as a
// CanvasTexture. No image files: the published artifact is one HTML document
// with a VRM already inlined in it, and there is no budget for asset downloads
// even if the CSP allowed them. What a few hundred lines of canvas buys is the
// one thing flat-coloured primitives cannot do -- ground that is not a single
// value across sixty metres.
//
// Every texture is cached and shared between scenes. That matters more than it
// looks: scenes are torn down and rebuilt on every swap, and the teardown
// disposes the materials it finds. Anything cached here is stamped
// `userData.shared` so disposeScenery leaves it alone -- without that, the
// second visit to a place renders white.
import * as THREE from 'three';

const cache = new Map();

function cached(key, build) {
  let texture = cache.get(key);
  if (texture) return texture;
  texture = build();
  texture.userData.shared = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

function paint(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  return new THREE.CanvasTexture(canvas);
}

// A small deterministic generator, so a texture is the same every run. Noise
// that reshuffles on reload is a texture you cannot tune by looking at it.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Speckle: the workhorse. A base colour, then thousands of small marks in two
// tones around it. At a distance it reads as material; up close it reads as
// grain rather than as a pattern, which is the whole trick -- a tiled pattern
// with any structure in it announces its tile size across a big flat ground.
function speckled({ size = 256, base, marks, count, minR, maxR, alpha = 1, seed = 7 }) {
  return paint(size, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const random = makeRandom(seed);
    ctx.globalAlpha = alpha;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = marks[Math.floor(random() * marks.length)];
      const x = random() * size;
      const y = random() * size;
      const r = minR + random() * (maxR - minR);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + random()), random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

export function grassTexture() {
  return cached('grass', () => {
    const texture = speckled({
      base: '#6fa15a',
      marks: ['#7cb063', '#5f8f4d', '#84b96b', '#557f45'],
      count: 2600, minR: 0.7, maxR: 2.6, seed: 11,
    });
    return texture;
  });
}

export function sandTexture() {
  return cached('sand', () => speckled({
    base: '#efe1bb',
    marks: ['#f6ecd2', '#e2d0a4', '#d8c391', '#faf3e2'],
    count: 3200, minR: 0.5, maxR: 1.6, seed: 23,
  }));
}

export function wetSandTexture() {
  return cached('wet-sand', () => speckled({
    base: '#c9b388',
    marks: ['#d4c098', '#b8a074', '#ded0ad'],
    count: 2400, minR: 0.6, maxR: 2.0, seed: 29,
  }));
}

export function asphaltTexture() {
  return cached('asphalt', () => speckled({
    base: '#4c4f55',
    marks: ['#585b62', '#43464b', '#63666d', '#3b3e43'],
    count: 3400, minR: 0.6, maxR: 2.2, seed: 41,
  }));
}

// Slabs. This one is deliberately structured -- a pavement is a grid and
// hiding that would be wrong -- so it is drawn at the size of a real slab and
// the repeat is set to match in the scene.
export function pavementTexture() {
  return cached('pavement', () => paint(256, (ctx, size) => {
    ctx.fillStyle = '#9a9689';
    ctx.fillRect(0, 0, size, size);
    const random = makeRandom(53);
    const cells = 4;
    const step = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        // Each slab a slightly different value, the way real ones weather.
        const shade = 148 + Math.floor(random() * 18);
        ctx.fillStyle = `rgb(${shade}, ${shade - 4}, ${shade - 16})`;
        ctx.fillRect(x * step + 1.5, y * step + 1.5, step - 3, step - 3);
      }
    }
    ctx.strokeStyle = 'rgba(90, 88, 80, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= cells; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
  }));
}

// A normal map of overlapping swells, for the sea and the pond. Scrolling its
// offset a little each frame is what makes water look like water; a still
// plane with a low roughness just looks like glass.
export function rippleNormal() {
  return cached('ripple', () => paint(256, (ctx, size) => {
    const image = ctx.createImageData(size, size);
    const data = image.data;
    // Sum a few sine waves at different angles and wavelengths, then take the
    // gradient of that height field. Wavelengths divide the texture size so
    // the result tiles without a seam.
    const waves = [
      { ax: 3, ay: 1, amp: 1.0, phase: 0 },
      { ax: -2, ay: 3, amp: 0.7, phase: 1.1 },
      { ax: 5, ay: -4, amp: 0.35, phase: 2.3 },
      { ax: 1, ay: 7, amp: 0.22, phase: 0.6 },
    ];
    const heightAt = (x, y) => {
      let h = 0;
      for (const wave of waves) {
        h += wave.amp * Math.sin(
          (wave.ax * x + wave.ay * y) * (Math.PI * 2 / size) + wave.phase
        );
      }
      return h;
    };
    const STRENGTH = 2.6;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = heightAt(x + 1, y) - heightAt(x - 1, y);
        const dy = heightAt(x, y + 1) - heightAt(x, y - 1);
        // Normal of the height field, packed into RGB the way a normal map is.
        let nx = -dx * STRENGTH;
        let ny = -dy * STRENGTH;
        const length = Math.hypot(nx, ny, 1);
        nx /= length;
        ny /= length;
        const nz = 1 / length;
        const index = (y * size + x) * 4;
        data[index] = (nx * 0.5 + 0.5) * 255;
        data[index + 1] = (ny * 0.5 + 0.5) * 255;
        data[index + 2] = (nz * 0.5 + 0.5) * 255;
        data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }));
}

// Building fronts, for the ones too far away to be worth building windows on.
// The lit variant is used as an emissive map after dark: two thirds of the
// windows on, because a block with every light burning reads as a film set.
export function facadeTexture(lit = false) {
  return cached(lit ? 'facade-lit' : 'facade', () => paint(256, (ctx, size) => {
    ctx.fillStyle = lit ? '#000000' : '#b9a893';
    ctx.fillRect(0, 0, size, size);
    const random = makeRandom(67);
    const cols = 6;
    const rows = 8;
    const cellW = size / cols;
    const cellH = size / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const on = random() > 0.34;
        if (lit && !on) continue;
        ctx.fillStyle = lit
          ? ['#ffd9a0', '#ffe9c4', '#cfe0ff'][Math.floor(random() * 3)]
          : '#2b3a48';
        ctx.fillRect(
          col * cellW + cellW * 0.22,
          row * cellH + cellH * 0.2,
          cellW * 0.56,
          cellH * 0.5
        );
      }
    }
  }));
}

// The repeat belongs to the surface, not to the texture: the same grass goes
// on a sixty-metre field and on a two-metre verge, and it would be one
// enormous blade on the first if the tiling were baked in. Clones are cached
// per repeat count as well, because a clone is a separate upload to the GPU
// and scenes are torn down and rebuilt every time you change place -- without
// the cache, swapping back and forth leaks one more copy each time.
export function tiled(texture, repeatX, repeatY = repeatX) {
  return cached(`${texture.uuid}:${repeatX}:${repeatY}`, () => {
    const copy = texture.clone();
    copy.repeat.set(repeatX, repeatY);
    return copy;
  });
}
