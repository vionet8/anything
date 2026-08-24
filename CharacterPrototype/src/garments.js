// Garments that are shapes rather than colours.
//
// Repainting the model's own Tops and Bottoms textures gets you a colourway --
// a navy cardigan, a white cardigan -- and that is genuinely all it gets you.
// A sailor collar, a pleated skirt and a frilled hem are not colours of a
// cardigan, they are different objects, and no amount of painting turns one
// into the other. So these are built and hung on the skeleton.
//
// Everything here is authored in world-ish metres against the model standing
// upright, and attached with `attachToBone`, which works out the local
// transform that puts it there. That way the numbers in this file are ones you
// can measure off the avatar -- the collar's back hem is at 1.10m because that
// is where a sailor collar's hem lands on a 1.76m figure -- rather than
// offsets in some bone's rotated local frame that mean nothing on their own.
import * as THREE from 'three';

// The torso, as an ellipse per height, measured off the avatar's skin mesh
// with window.__char.bodyProfileForTest rather than guessed. One profile,
// shared by everything that lies on the body: the collar used to carry its own
// and it was far too small -- half-depth 56mm at the chest against the shirt's
// 104mm -- so the collar's front bands were built three centimetres inside the
// blouse they were meant to sit on, and only the top of them poked out, which
// read as a bow tie stuck to her collarbone.
//
// She is markedly wider than she is deep, so this cannot collapse to a radius.
const TORSO = [
  { y: 0.945, rx: 0.118, rz: 0.096 },   // hip, where a tucked-in shirt ends
  { y: 1.005, rx: 0.114, rz: 0.092 },
  { y: 1.070, rx: 0.110, rz: 0.090 },   // waist
  { y: 1.130, rx: 0.113, rz: 0.098 },
  { y: 1.190, rx: 0.117, rz: 0.104 },   // chest
  { y: 1.240, rx: 0.124, rz: 0.100 },   // shoulders, the widest point
  { y: 1.272, rx: 0.108, rz: 0.086 },
  { y: 1.286, rx: 0.050, rz: 0.048 },   // neck hole
];

// How far a shirt hangs off the body: closer at the shoulders, where it is
// held up, further below. A constant offset reads as shrink-wrap.
function shirtLift(y) {
  const t = THREE.MathUtils.clamp((y - TORSO[0].y) / (TORSO[TORSO.length - 1].y - TORSO[0].y), 0, 1);
  return 0.013 + (1 - t) * 0.009;
}

// The torso surface at any height, with `extra` added for a layer that goes
// over the shirt rather than being it.
function torsoAt(y, extra = 0) {
  let lo = TORSO[0];
  let hi = TORSO[TORSO.length - 1];
  for (let i = 0; i < TORSO.length - 1; i++) {
    if (y >= TORSO[i].y && y <= TORSO[i + 1].y) { lo = TORSO[i]; hi = TORSO[i + 1]; break; }
  }
  const span = hi.y - lo.y;
  const t = span > 1e-6 ? THREE.MathUtils.clamp((y - lo.y) / span, 0, 1) : 0;
  const off = shirtLift(y) + extra;
  return {
    rx: lo.rx + (hi.rx - lo.rx) * t + off,
    rz: lo.rz + (hi.rz - lo.rz) * t + off,
  };
}

// Puts a group where it belongs in the world and then hands it to a bone, so
// it follows the body from then on. Authoring in world space and converting
// once is much easier to reason about than authoring in a bone's local frame,
// especially on a VRM0 rig where the root carries a half turn.
export function attachToBone(bone, group, { position, rotation, scale = 1 }) {
  bone.updateWorldMatrix(true, false);
  const target = new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(rotation || new THREE.Euler()),
    new THREE.Vector3(scale, scale, scale)
  );
  const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(target);
  group.matrix.copy(local);
  group.matrix.decompose(group.position, group.quaternion, group.scale);
  group.matrixAutoUpdate = true;
  bone.add(group);
  return group;
}

// ---- ブラウス ----
// A top that replaces the model's own rather than lying over it.
//
// This exists because laying a sailor collar over whatever the avatar already
// wears cannot be made to work, and the three characters fail it three
// different ways: on one the collar is swallowed whole by a knit cardigan, on
// the next it is hidden by hair that reaches her knees, and on the third it
// pokes through a puffer jacket as a small dark lump. A collar is part of a
// shirt. So the uniform outfits hide the model's Tops mesh and wear this
// instead, and the collar goes on a surface whose distance from the body is
// known rather than guessed.
//
// The body it has to fit is measured, not assumed -- window.__char
// .bodyProfileForTest reads the skin mesh's half-width and half-depth at any
// height, and these stations come from it. A shirt is not a cylinder: she is
// nearly twice as wide as she is deep at the waist and squarer at the chest.
export function makeBlouse({
  cloth = 0xf6f7f9, hemY = 0.945, neckY = 1.286, sleeve = 0.15, sleeveCloth = null,
} = {}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.87, side: THREE.DoubleSide,
  });

  const STATIONS = TORSO;
  const COLS = 26;
  const positions = [];
  const indices = [];
  for (const station of STATIONS) {
    const at = torsoAt(station.y);
    for (let c = 0; c <= COLS; c++) {
      const angle = (c / COLS) * Math.PI * 2;
      positions.push(Math.sin(angle) * at.rx, station.y, Math.cos(angle) * at.rz);
    }
  }
  for (let r = 0; r < STATIONS.length - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = r * (COLS + 1) + c;
      const b = a + 1;
      const d = a + COLS + 1;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const shell = new THREE.Mesh(geometry, material);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  group.userData.garment = 'blouse';
  group.userData.sleeve = sleeve;
  group.userData.sleeveCloth = sleeveCloth === null ? cloth : sleeveCloth;
  group.userData.stations = STATIONS;
  return group;
}

// A short sleeve, hung on an upper-arm bone so it turns with the arm. Built
// down the bone's own -Y, which is the direction an arm bone points in a VRM
// rig once the rest pose is normalised.
export function makeSleeve({ cloth = 0xf6f7f9, length = 0.15, top = 0.062, bottom = 0.054 } = {}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.87, side: THREE.DoubleSide,
  });
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(top, bottom, length, 18, 1, true), material
  );
  tube.position.y = -length / 2;
  tube.castShadow = true;
  group.add(tube);
  // A cap over the shoulder end, so the sleeve is not an open pipe seen from
  // above when she raises her arm.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(top, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), material);
  group.add(cap);
  group.userData.garment = 'sleeve';
  return group;
}

// ---- セーラー襟 ----
// The big square flap over the shoulders and back, the two strips running down
// the front to a V, and the neckerchief through them. Built as a surface laid
// on the torso ellipse rather than as a flat plane, and offset outwards by the
// thickness of cloth so it does not fight the shirt underneath.
//
// A sailor collar is square at the back and comes to a V at the front, and the
// V is a good deal lower than people remember -- somewhere around the bottom
// of the sternum. Cutting it short is what makes a collar read as a bib.
export function makeSailorCollar({
  cloth = 0xffffff, stripe = 0x2c3a5e, scale = 1,
} = {}) {
  const group = new THREE.Group();
  const clothMat = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.86, side: THREE.DoubleSide,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: stripe, roughness: 0.84, side: THREE.DoubleSide,
  });

  const NECK_Y = 1.272;
  const BACK_HEM = 1.058;
  // Clear of the *outer* garment, not the skin. The first value here was 12mm,
  // measured off the torso, and the collar came out entirely inside a chunky
  // cardigan -- visible in the render as nothing at all.
  // Over the shirt, not over the skin -- torsoAt already carries the
  // shirt's own clearance.
  const LIFT = 0.010 * scale;

  // The back flap. Runs from the base of the neck round the shoulders to about
  // the level of the shoulder blades, squared off at the bottom.
  const COLS = 15;
  const ROWS = 9;
  const build = (material, uFrom, uTo, topY, bottomY, widen, lift = LIFT) => {
    const positions = [];
    const indices = [];
    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS;
      const y = topY + (bottomY - topY) * v;
      const body = torsoAt(y, lift);
      // The flap widens as it falls, which is what squares off a sailor collar
      // instead of leaving it a tube.
      const grow = 1 + widen * v;
      for (let c = 0; c <= COLS; c++) {
        const u = uFrom + (uTo - uFrom) * (c / COLS);
        const angle = u * Math.PI * 2;
        positions.push(
          Math.sin(angle) * body.rx * grow,
          y,
          Math.cos(angle) * body.rz * grow
        );
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        const b = a + 1;
        const d = a + COLS + 1;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  };

  // Back: from one shoulder round the back to the other. u is measured with 0
  // at her front, so the back runs 0.25 to 0.75.
  group.add(build(stripeMat, 0.235, 0.765, NECK_Y, BACK_HEM, 0.16));
  // A white band inside the navy, the two stripes a sailor collar carries.
  const trim = build(clothMat, 0.255, 0.745, NECK_Y + 0.002, BACK_HEM - 0.026, 0.14);
  trim.scale.multiplyScalar(1.0);
  group.add(trim);
  group.add(build(stripeMat, 0.272, 0.728, NECK_Y + 0.004, BACK_HEM - 0.044, 0.12));

  // Front: two strips from the shoulders down to the V. They narrow as they
  // fall and stop short of meeting, which is where the neckerchief goes.
  //
  // Further out than the back flap. A cardigan is thicker down the front than
  // across the shoulders, and at the back-flap's clearance these two vanished
  // inside it -- the collar read from behind and not at all from the front,
  // which is the wrong way round for the one detail that says sailor.
  const FRONT_LIFT = LIFT * 1.5;
    // Narrow. These sit *on top of* whatever the model happens to be wearing,
  // and how far out that is varies by character and by outfit -- a chunky
  // puffer stands twice as far off the chest as a knit cardigan does. At panel
  // width the mismatch reads as two rectangles stuck to her front; as a pair of
  // thin edges it reads as the collar's trim wherever it lands. The real fix is
  // for a sailor uniform to replace the top rather than lie over it, which
  // means building the shirt as well.
  const V_Y = 1.104;
  for (const [from, to] of [[0.952, 0.982], [0.018, 0.048]]) {
    group.add(build(stripeMat, from, to, NECK_Y, V_Y, 0.0, FRONT_LIFT));
  }

  // The neckerchief: a small triangle hanging at the base of the V.
  const scarf = new THREE.Mesh(new THREE.BufferGeometry(), stripeMat);
  {
    const body = torsoAt(1.12, FRONT_LIFT);
    const w = 0.026 * scale;
    const front = body.rz + 0.004;
    const positions = [
      -w, 1.110, front,
      w, 1.110, front,
      0, 1.012, front + 0.012 * scale,
    ];
    scarf.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    scarf.geometry.computeVertexNormals();
  }
  scarf.castShadow = true;
  group.add(scarf);

  // The knot, where the strips cross.
  const knot = new THREE.Mesh(
    new THREE.SphereGeometry(0.011 * scale, 10, 8),
    new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.8 })
  );
  const at = torsoAt(1.112, FRONT_LIFT);
  knot.position.set(0, 1.112, at.rz + 0.006);
  knot.scale.set(1.4, 0.8, 0.6);
  group.add(knot);

  group.userData.garment = 'collar';
  return group;
}

// ---- プリーツスカート ----
// A ring of knife pleats: at the waist the cloth is a smooth circle, at the
// hem it zigzags between an outer fold and an inner one. That alternation is
// the whole thing -- a plain cone with a wavy hem reads as a lampshade.
export function makePleatedSkirt({
  cloth = 0x2c3a5e, pleats = 24, waistY = 0.965, hemY = 0.735,
  waist = 0.118, flare = 0.086, depth = 0.028, scale = 1,
} = {}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.88, side: THREE.DoubleSide,
  });

  const ROWS = 6;
  const positions = [];
  const indices = [];
  const cols = pleats * 2;               // an outer fold and an inner one each
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const y = (waistY + (hemY - waistY) * v) * scale;
    // The pleats open as they fall: at the waist they are pressed flat.
    const open = v * v * (3 - 2 * v);
    for (let c = 0; c <= cols; c++) {
      const angle = (c / cols) * Math.PI * 2;
      const outer = c % 2 === 0;
      const radius = (waist + flare * open + (outer ? 0 : -depth * open)) * scale;
      // Each pleat is turned slightly, so the folds face one way round the
      // skirt the way pressed knife pleats do rather than reading as flutes.
      const skew = outer ? 0 : (Math.PI / cols) * 0.55 * open;
      positions.push(
        Math.sin(angle + skew) * radius,
        y,
        Math.cos(angle + skew) * radius
      );
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const skirt = new THREE.Mesh(geometry, material);
  skirt.castShadow = true;
  skirt.receiveShadow = true;
  group.add(skirt);

  // A waistband, so the top of the skirt is a hem and not an open pipe.
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(waist * scale * 1.02, waist * scale * 1.02, 0.036 * scale, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.8, side: THREE.DoubleSide })
  );
  band.position.y = (waistY + 0.014) * scale;
  band.castShadow = true;
  group.add(band);

  group.userData.garment = 'skirt';
  group.userData.hemY = hemY * scale;
  group.userData.hemRadius = (waist + flare) * scale;
  return group;
}

// ---- フリル ----
// A gathered hem for the idol costume and the frilled swimsuit: a band of
// overlapping scallops hung under a skirt. Built as its own ring so it can be
// added to any hem without rebuilding the garment.
export function makeFrillRing({
  cloth = 0xfdf2f5, radius = 0.2, y = 0.735, drop = 0.05, scallops = 22,
  amplitude = 0.012, scale = 1,
} = {}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.9, side: THREE.DoubleSide,
  });

  // A ruffled band, not a ring of little domes. The first version hung a row
  // of downward-facing sphere caps under the hem: their visible surface points
  // at the ground, so every frill came out charcoal however pale its colour
  // was, and the fix is not a brighter colour, it is a surface that faces
  // outwards. A band whose radius waves in and out as it goes round, and waves
  // more the further down it falls, is what a gathered hem actually is.
  const ROWS = 5;
  const COLS = scallops * 6;
  const positions = [];
  const indices = [];
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const yy = (y - drop * v) * scale;
    for (let c = 0; c <= COLS; c++) {
      const angle = (c / COLS) * Math.PI * 2;
      const wave = Math.sin(angle * scallops) * amplitude * v * scale;
      const rr = radius * scale + wave + drop * v * 0.35 * scale;
      positions.push(Math.sin(angle) * rr, yy, Math.cos(angle) * rr);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = r * (COLS + 1) + c;
      const b = a + 1;
      const d = a + COLS + 1;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const band = new THREE.Mesh(geometry, material);
  band.castShadow = true;
  group.add(band);

  group.userData.garment = 'frill';
  return group;
}
