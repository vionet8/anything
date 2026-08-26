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

// The torso, as an ellipse per height.
//
// Measured off the avatar's skin mesh with window.__char.bodyProfileForTest,
// which picks torso vertices by the bone that drives them -- taking every skin
// vertex at a height sweeps in the arms and hands and gives you her whole
// silhouette instead of her ribcage.
//
// THE TRAP, and it cost several rounds: these numbers are in the *reference*
// frame of a 1.756m figure, and the measurements come out in the frame of
// whoever is standing there. attachToBone scales the finished garment by
// height/1.756, so a measurement taken on a 1.613m character has to be divided
// by 0.9185 before it goes in this table. Putting the raw measurement in mixes
// the two frames, and everything lands about eight per cent low and eight per
// cent small: the shirt's neckline sat at her chest with the camisole showing
// above it, the collar hung eleven centimetres below her neck, and the bust
// poked through the front. One conversion explains all three.
const TORSO = [
  { y: 1.023, rx: 0.123, rz: 0.113 },   // hip, where a tucked-in shirt ends
  { y: 1.089, rx: 0.103, rz: 0.109 },   // waist, the narrowest
  { y: 1.154, rx: 0.102, rz: 0.110 },
  { y: 1.219, rx: 0.114, rz: 0.123 },
  { y: 1.252, rx: 0.126, rz: 0.145 },   // bust -- deeper than she is wide here
  { y: 1.300, rx: 0.112, rz: 0.118 },
  { y: 1.340, rx: 0.078, rz: 0.082 },   // coming in towards the shoulders
  { y: 1.378, rx: 0.050, rz: 0.056 },   // neck hole
];

// The same body, but falling straight from the bust instead of nipping in at
// the waist. A blazer's shirt can taper like any shirt; a sailor top's fabric
// is thick and stiff and does not, which is most of what gives a sailor
// uniform its silhouette -- and the first version used the tailored TORSO for
// it regardless, so it looked like a fitted blouse with a collar stapled on.
// Built by taking the bust station's radius as a floor for everything below
// it, so the waist and hip cannot pinch in narrower than the bust.
const STRAIGHT_TORSO = (() => {
  const bust = TORSO.find((s) => s.y === 1.252);
  return TORSO.map((s) => (s.y <= bust.y
    ? { y: s.y, rx: Math.max(s.rx, bust.rx), rz: Math.max(s.rz, bust.rz) }
    : s));
})();

// How far a shirt hangs off the body: closer at the shoulders, where it is
// held up, further below. A constant offset reads as shrink-wrap.
function shirtLift(y) {
  const t = THREE.MathUtils.clamp((y - TORSO[0].y) / (TORSO[TORSO.length - 1].y - TORSO[0].y), 0, 1);
  return 0.010 + (1 - t) * 0.006;
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
  cloth = 0xf6f7f9, hemY = 1.023, neckY = 1.378, sleeve = 0.15, sleeveCloth = null,
  straight = false,
} = {}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.87, side: THREE.DoubleSide,
  });

  const STATIONS = straight ? STRAIGHT_TORSO : TORSO;
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
//
// The cap that closes the shoulder end used to be a full hemisphere at the
// sleeve's own radius, sitting right at the shoulder joint -- the single most
// visible point of the whole silhouette. A dome that size does not read as
// "the top of a sleeve," it reads as a shoulder pad, and stacked on both
// arms it was the entire "shoulders wider than the body" effect this was
// reported against. A flat disc closes the same opening without adding a
// single millimetre of width the cylinder does not already have.
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
  const cap = new THREE.Mesh(new THREE.CircleGeometry(top, 18), material);
  cap.rotation.x = -Math.PI / 2;
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
  // Plain navy, for the pieces that are a single flat colour and were never
  // at risk of the panels' z-fighting: the chest guard, the scarf, the knot.
  const navyMat = new THREE.MeshStandardMaterial({
    color: stripe, roughness: 0.84, side: THREE.DoubleSide,
  });

  const NECK_Y = 1.372;
  const BACK_HEM = 1.190;
  const V_Y = 1.235;
  // Clear of the *outer* garment, not the skin. The first value here was 12mm,
  // measured off the torso, and the collar came out entirely inside a chunky
  // cardigan -- visible in the render as nothing at all. Over the shirt, not
  // over the skin -- torsoAt already carries the shirt's own clearance.
  const LIFT = 0.010 * scale;
  // Further out than the back flap. A cardigan is thicker down the front than
  // across the shoulders, and at the back-flap's clearance the front strips
  // vanished inside it -- the collar read from behind and not at all from the
  // front, which is the wrong way round for the one detail that says sailor.
  const FRONT_LIFT = LIFT * 1.5;

  // Every panel here is one vertex-coloured surface -- navy cloth with a
  // white border painted near its own edges -- rather than three stacked
  // shapes in navy/white/navy. The stacked version put all three layers at
  // the same radius with only their edges inset from one another, which is
  // coplanar geometry wherever they overlap; the GPU has no consistent answer
  // for which layer wins that depth test, and what actually rendered was a
  // field of flickering dashes rather than clean piping, worst exactly where
  // the collar is most visible: right behind her neck. A single surface
  // cannot z-fight with itself.
  //
  // The old code also scaled the *radius* by a `widen` factor across the
  // whole u-range, including the side edges, to square the flap's bottom
  // corners off. Applied at the sides that pushed the fabric outward as it
  // fell, flaring the back flap into wings past her shoulders. There is no
  // widen here: torsoAt's own curve already goes from a narrow neck to a
  // full shoulder width over that span, which is the squaring off, and
  // adding a second multiplier on top of it is what broke the shape.
  const navy = new THREE.Color(stripe);
  const white = new THREE.Color(cloth);
  const trimmed = (uFrac, vFrac, edges, border) => (
    (edges.includes('uStart') && uFrac < border)
    || (edges.includes('uEnd') && uFrac > 1 - border)
    || (edges.includes('vEnd') && vFrac > 1 - border * 1.3)
  );
  const buildPanel = (uFrom, uTo, topY, bottomY, lift, edges, border = 0.12) => {
    const COLS = 22;
    const ROWS = 11;
    const positions = [];
    const colors = [];
    const indices = [];
    const c = new THREE.Color();
    // uFrom/uTo may be numbers or functions of vFrac -- the back flap needs
    // a u-range that narrows as it falls (see the note above the call), and a
    // constant number is just a function that ignores its argument.
    const uf = typeof uFrom === 'function' ? uFrom : () => uFrom;
    const ut = typeof uTo === 'function' ? uTo : () => uTo;
    for (let r = 0; r <= ROWS; r++) {
      const vFrac = r / ROWS;
      const y = topY + (bottomY - topY) * vFrac;
      const at = torsoAt(y, lift);
      const rowFrom = uf(vFrac);
      const rowTo = ut(vFrac);
      for (let col = 0; col <= COLS; col++) {
        const uFrac = col / COLS;
        const u = rowFrom + (rowTo - rowFrom) * uFrac;
        const angle = u * Math.PI * 2;
        positions.push(Math.sin(angle) * at.rx, y, Math.cos(angle) * at.rz);
        c.copy(trimmed(uFrac, vFrac, edges, border) ? white : navy);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const a = r * (COLS + 1) + col;
        const b = a + 1;
        const d = a + COLS + 1;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  };

  // The back flap: shoulder point to shoulder point round the back, trimmed
  // along both sides and across the squared-off bottom hem. u is measured
  // with 0 at her front, so the back runs roughly 0.235 to 0.765 up near the
  // neck -- but that span has to narrow as the flap falls, not stay constant.
  // torsoAt's own radius nearly doubles between the neck and the back hem
  // (the neck-to-shoulder taper), and a constant angular span swept at a
  // doubled radius sweeps double the arc length: at the original constant
  // 0.235/0.765 the flap's lower corners landed almost due sideways from her
  // body rather than over her shoulder blades, projecting past her actual
  // shoulders as two wings. Narrowing the span as it falls keeps the edge
  // roughly over the same point on her body at every height instead.
  group.add(buildPanel(
    (v) => 0.235 + (0.335 - 0.235) * v,
    (v) => 0.765 - (0.765 - 0.665) * v,
    NECK_Y, BACK_HEM, LIFT, ['uStart', 'uEnd', 'vEnd']
  ));

  // The front: two strips from the shoulders down to the V, trimmed along
  // their outer edge and the bottom hem where they run into the chest guard --
  // not the inner edge, since that is where the guard sits behind them, not a
  // hem of its own. `uFrom` is always the outer side here so `edges` can stay
  // the same for both strips despite the two spans running opposite ways
  // round the front centre-line.
  group.add(buildPanel(0.048, 0.018, NECK_Y, V_Y, FRONT_LIFT, ['uStart', 'vEnd']));
  group.add(buildPanel(0.952, 0.982, NECK_Y, V_Y, FRONT_LIFT, ['uStart', 'vEnd']));

  // The chest guard (胸当て): a triangular panel of the collar's own cloth,
  // filling the V the two front strips leave open. A collar with a V this
  // deep is not worn over bare shirt in the gap -- the gap is faced with its
  // own piece of fabric, sewn behind the strips -- and without it the V shows
  // the blouse straight through as a wedge of the wrong colour.
  {
    const guard = new THREE.Mesh(new THREE.BufferGeometry(), navyMat);
    const ROWS_G = 6;
    const positions = [];
    const indices = [];
    for (let r = 0; r <= ROWS_G; r++) {
      const v = r / ROWS_G;
      const y = NECK_Y + (V_Y - NECK_Y) * v;
      const at = torsoAt(y, FRONT_LIFT - 0.003);   // just behind the strips
      const half = 0.048 * scale * (1 - v);        // narrows to a point at the V
      positions.push(-half, y, at.rz, half, y, at.rz);
    }
    for (let r = 0; r < ROWS_G; r++) {
      const a = r * 2; const b = a + 1; const d = a + 2; const e = a + 3;
      indices.push(a, d, b, b, d, e);
    }
    guard.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    guard.geometry.setIndex(indices);
    guard.geometry.computeVertexNormals();
    guard.castShadow = true;
    group.add(guard);
  }

  // The neckerchief. A real one is a square scarf roughly 85cm on a side,
  // folded corner to corner into a triangle with a 120cm hypotenuse and
  // draped through the V loosely rather than pinned flat against it -- the
  // first version, at a 5cm half-width, was closer to a lapel pin than a
  // scarf. Bigger now, and hanging further down than the guard behind it.
  const scarf = new THREE.Mesh(new THREE.BufferGeometry(), navyMat);
  {
    const body = torsoAt(1.262, FRONT_LIFT + 0.008);
    const w = 0.075 * scale;
    const front = body.rz + 0.006;
    const positions = [
      -w, 1.262, front,
      w, 1.262, front,
      0, 1.085, front + 0.020 * scale,
    ];
    scarf.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    scarf.geometry.computeVertexNormals();
  }
  scarf.castShadow = true;
  group.add(scarf);

  // The knot, where the strips cross.
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.013 * scale, 10, 8), navyMat);
  const at = torsoAt(1.262, FRONT_LIFT + 0.008);
  knot.position.set(0, 1.262, at.rz + 0.008);
  knot.scale.set(1.5, 0.85, 0.6);
  group.add(knot);

  group.userData.garment = 'collar';
  return group;
}

// ---- ブレザー ----
// The jacket worn over the blouse: notched lapels rolling open at the front
// down to a button, closed above and below that the way a blazer actually
// reads from a few metres away -- as one piece of cloth with two triangular
// flaps at the top, not as two independent panels laced together. Two things
// about the front are not just style:
//
//  - The gap the lapels open onto is not symmetric. Her left edge reaches
//    further in towards the centre than her right edge does, because a
//    women's jacket closes left over right -- the opposite of a man's -- and
//    an even gap on both sides reads as a men's jacket regardless of anything
//    else about the shape.
//  - The lapels are not flat against the body. A lapel is the same cloth as
//    the collar, folded back and outward, so its outer edge stands proud of
//    the chest rather than following the body's own curve the way the rest
//    of the jacket does.
//
// This is stylised, not a cloth simulation -- the notch where the collar
// meets the lapel is a seam between two separate meshes rather than a
// modelled cut, which is close enough at the polygon count everything else
// here is built at.
export function makeBlazerJacket({
  cloth = 0x222a46, button = 0x14182a, buttonY = 1.205, hemY = 1.010,
  sleeve = 0.24, sleeveCloth = null,
} = {}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cloth, roughness: 0.68, side: THREE.DoubleSide,
  });

  const NECK_Y = 1.372;
  const LIFT = 0.018;

  // How wide the front gap is at a given height: zero at the button, widest
  // at the neckline, and narrower on her left than on her right -- see the
  // note above.
  const gapRight = (y) => 0.150 * THREE.MathUtils.clamp((y - buttonY) / (NECK_Y - buttonY), 0, 1);
  const gapLeft = (y) => 0.070 * THREE.MathUtils.clamp((y - buttonY) / (NECK_Y - buttonY), 0, 1);

  // ---- The body: one tube, closed below the button and gapped above it. ----
  {
    const ROWS = 11;
    const COLS = 30;
    const positions = [];
    const indices = [];
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const y = hemY + (NECK_Y - hemY) * t;
      const at = torsoAt(y, LIFT);
      const gR = gapRight(y);
      const gL = gapLeft(y);
      // The ring runs from her right gap edge, the long way round through the
      // back, to her left gap edge -- the whole circle minus the notch at the
      // front, which closes to nothing at the button.
      for (let c = 0; c <= COLS; c++) {
        const u = gR + (1 - gL - gR) * (c / COLS);
        const angle = u * Math.PI * 2;
        positions.push(Math.sin(angle) * at.rx, y, Math.cos(angle) * at.rz);
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
    const body = new THREE.Mesh(geometry, material);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
  }

  // ---- The lapels: two flaps rolling outward from the gap's edge. ----
  // Each is a strip over the same height range as the gap: its inner edge
  // follows the gap boundary at the body's own radius, and its outer edge
  // swings back towards the centre and bulges out past the body -- which is
  // what a folded-back lapel actually is, not a flat panel lying against the
  // chest.
  //
  // The two are not mirror images, on purpose. A pair built from one function
  // with a sign flip came out reading as a zipper -- both edges stopping
  // politely near the centre-line, close enough in magnitude that nothing
  // told the eye which side was on top. What actually reads as an overlap is
  // one edge visibly crossing onto the *other* side of the centre-line while
  // the other stays clear of it, so these are two distinct shapes: her right
  // lapel folds back only across its own side and no further; her left one --
  // the one on top -- rolls all the way past the centre and a little into
  // her right side, over the top of it. `u` past 1 is not a bug: angle = u *
  // 2π is periodic, so u = 1.05 lands in exactly the small-positive-u
  // territory her right lapel occupies, which is the crossing this needs.
  const buildLapelStrip = (innerU, outerU, bulge) => {
    const ROWS2 = 8;
    const positions = [];
    const indices = [];
    for (let r = 0; r <= ROWS2; r++) {
      const v = r / ROWS2;
      const y = buttonY + (NECK_Y - buttonY) * v;
      const at = torsoAt(y, LIFT);
      const innerAngle = innerU(v) * Math.PI * 2;
      positions.push(Math.sin(innerAngle) * at.rx, y, Math.cos(innerAngle) * at.rz);
      const outerAngle = outerU(v) * Math.PI * 2;
      const b = bulge(v);
      positions.push(
        Math.sin(outerAngle) * (at.rx + b), y - 0.006, Math.cos(outerAngle) * (at.rz + b)
      );
    }
    for (let r = 0; r < ROWS2; r++) {
      const a = r * 2; const b = a + 1; const d = a + 2; const e = a + 3;
      indices.push(a, d, b, b, d, e);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  };

  // Her right lapel: tucked under, folding back only a third of the way from
  // its own edge towards the centre.
  group.add(buildLapelStrip(
    (v) => gapRight(buttonY + (NECK_Y - buttonY) * v),
    (v) => gapRight(buttonY + (NECK_Y - buttonY) * v) * 0.4,
    (v) => 0.018 * (0.3 + 0.7 * v)
  ));
  // Her left lapel: the one on top, crossing all the way past the centre
  // line and into her right side's territory.
  group.add(buildLapelStrip(
    (v) => 1 - gapLeft(buttonY + (NECK_Y - buttonY) * v),
    (v) => 1 + 0.045 * v,
    (v) => 0.040 * (0.3 + 0.7 * v)
  ));

  // ---- The collar stand: a narrow band round the back of the neck. ----
  {
    const ROWS3 = 3;
    const COLS3 = 14;
    const positions = [];
    const indices = [];
    const topY = NECK_Y + 0.020;
    const botY = NECK_Y - 0.006;
    for (let r = 0; r <= ROWS3; r++) {
      const v = r / ROWS3;
      const y = topY + (botY - topY) * v;
      const at = torsoAt(NECK_Y, LIFT + 0.010);
      const rr = 1 - Math.abs(v - 0.4) * 0.3;
      for (let c = 0; c <= COLS3; c++) {
        // Shoulder point to shoulder point round the back -- the same span
        // the sailor collar's own back flap uses.
        const u = 0.235 + (0.765 - 0.235) * (c / COLS3);
        const angle = u * Math.PI * 2;
        positions.push(Math.sin(angle) * at.rx * rr, y, Math.cos(angle) * at.rz * rr);
      }
    }
    for (let r = 0; r < ROWS3; r++) {
      for (let c = 0; c < COLS3; c++) {
        const a = r * (COLS3 + 1) + c;
        const b = a + 1;
        const d = a + COLS3 + 1;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const collar = new THREE.Mesh(geometry, material);
    collar.castShadow = true;
    group.add(collar);
  }

  // ---- Buttons ----
  // The second one sits about level with where a pocket would be, which is
  // the one hard number the reference material gave for spacing them.
  const buttonMat = new THREE.MeshStandardMaterial({ color: button, roughness: 0.4 });
  for (const y of [buttonY, buttonY - 0.062]) {
    const at = torsoAt(y, LIFT + 0.004);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), buttonMat);
    dot.position.set(0, y, at.rz);
    dot.scale.z = 0.6;
    group.add(dot);
  }

  group.userData.garment = 'jacket';
  group.userData.sleeve = sleeve;
  group.userData.sleeveCloth = sleeveCloth === null ? cloth : sleeveCloth;
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
