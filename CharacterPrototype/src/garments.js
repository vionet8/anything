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

// The torso, as an ellipse per height. Cloth that lies on the body has to
// follow the body, and a collar built on a flat plane stands off her back like
// a signboard. Radii are measured off the avatar: half-width at the chest is
// about 0.10 and half-depth about 0.075, narrowing to the neck.
function torsoAt(y, scale = 1) {
  // 0 at the waist, 1 at the base of the neck.
  const t = THREE.MathUtils.clamp((y - 0.95) / 0.33, 0, 1);
  const rx = (0.108 - t * 0.036) * scale;
  const rz = (0.076 - t * 0.026) * scale;
  return { rx, rz };
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
  const BACK_HEM = 1.098;
  // Clear of the *outer* garment, not the skin. The first value here was 12mm,
  // measured off the torso, and the collar came out entirely inside a chunky
  // cardigan -- visible in the render as nothing at all.
  const LIFT = 0.044 * scale;

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
      const body = torsoAt(y, scale);
      // The flap widens as it falls, which is what squares off a sailor collar
      // instead of leaving it a tube.
      const grow = 1 + widen * v;
      for (let c = 0; c <= COLS; c++) {
        const u = uFrom + (uTo - uFrom) * (c / COLS);
        const angle = u * Math.PI * 2;
        positions.push(
          Math.sin(angle) * (body.rx * grow + lift),
          y,
          Math.cos(angle) * (body.rz * grow + lift)
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
  group.add(build(stripeMat, 0.235, 0.765, NECK_Y, BACK_HEM, 0.30));
  // A white band inside the navy, the two stripes a sailor collar carries.
  const trim = build(clothMat, 0.255, 0.745, NECK_Y + 0.002, BACK_HEM - 0.026, 0.26);
  trim.scale.multiplyScalar(1.0);
  group.add(trim);
  group.add(build(stripeMat, 0.272, 0.728, NECK_Y + 0.004, BACK_HEM - 0.044, 0.22));

  // Front: two strips from the shoulders down to the V. They narrow as they
  // fall and stop short of meeting, which is where the neckerchief goes.
  //
  // Further out than the back flap. A cardigan is thicker down the front than
  // across the shoulders, and at the back-flap's clearance these two vanished
  // inside it -- the collar read from behind and not at all from the front,
  // which is the wrong way round for the one detail that says sailor.
  const FRONT_LIFT = LIFT * 1.9;
    // Narrow. These sit *on top of* whatever the model happens to be wearing,
  // and how far out that is varies by character and by outfit -- a chunky
  // puffer stands twice as far off the chest as a knit cardigan does. At panel
  // width the mismatch reads as two rectangles stuck to her front; as a pair of
  // thin edges it reads as the collar's trim wherever it lands. The real fix is
  // for a sailor uniform to replace the top rather than lie over it, which
  // means building the shirt as well.
  for (const [from, to] of [[0.938, 0.972], [0.028, 0.062]]) {
    group.add(build(stripeMat, from, to, NECK_Y, 1.132, 0.0, FRONT_LIFT));
  }

  // The neckerchief: a small triangle hanging at the base of the V.
  const scarf = new THREE.Mesh(new THREE.BufferGeometry(), stripeMat);
  {
    const body = torsoAt(1.17, scale);
    const w = 0.032 * scale;
    const positions = [
      -w, 1.196, body.rz + FRONT_LIFT + 0.006,
      w, 1.196, body.rz + FRONT_LIFT + 0.006,
      0, 1.108, body.rz + FRONT_LIFT + 0.016,
    ];
    scarf.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    scarf.geometry.computeVertexNormals();
  }
  scarf.castShadow = true;
  group.add(scarf);

  // The knot, where the strips cross.
  const knot = new THREE.Mesh(
    new THREE.SphereGeometry(0.017 * scale, 10, 8),
    new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.8 })
  );
  const at = torsoAt(1.192, scale);
  knot.position.set(0, 1.192, at.rz + FRONT_LIFT + 0.010);
  knot.scale.set(1.5, 0.85, 0.7);
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
