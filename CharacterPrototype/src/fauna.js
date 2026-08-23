// The animals. One set per place, because what turns up on a shopping street
// is not what turns up on a headland beach, and a game about photographing a
// place gets most of its life from what wanders into the frame.
//
//   自然公園   オオルリ  small woodland flycatcher, 14cm -- will sit on her hand
//   街並み     ドバト    feral pigeon, 33cm -- walks, will not perch on a person
//   砂浜       ウミネコ  black-tailed gull, 47cm -- long wings, stays on the sand
//              スナガニ  ghost crab, 3cm across -- scuttles sideways, sits in the surf line
//
// Sizes are from the field guides, not from eyeballing: ドバト 全長33cm,
// ハシブトガラス 57cm, ウミネコ 全長47cm 翼開長120cm, スナガニ 甲幅2.5-3cm.
//
// These are not one bird with three colour schemes and a scale factor. A
// pigeon is not a large sparrow -- it has a far deeper chest, a much smaller
// head for its body, a short thick neck, a square tail and stubby legs, and
// getting any one of those wrong is what makes a model read as a toy. What is
// shared here is the *construction*: loft a hull along a spine, build wings
// out of individual feathers, give every bill two mandibles. The anatomy is
// written out per species.
import * as THREE from 'three';

// ---- Construction toolkit ----

// Sweeps an ellipse along a spine, one ring of vertices per station, and
// stitches the rings into a hull. Radii are per station and per axis, so a
// body can be broader than it is deep where the animal's is.
// Catmull-Rom through the spine stations, so a hull built from a dozen
// hand-placed rings comes out smooth instead of faceted. Hand-placing forty
// rings is not the answer -- the shape is easier to think about as a dozen
// landmarks, and the curve between them is arithmetic.
function smoothSpine(stations, per = 4) {
  if (stations.length < 3) return stations;
  const at = (i) => stations[Math.max(0, Math.min(stations.length - 1, i))];
  const out = [];
  const spline = (a, b, c, d, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * ((2 * b) + (-a + c) * t
      + (2 * a - 5 * b + 4 * c - d) * t2
      + (-a + 3 * b - 3 * c + d) * t3);
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    const steps = i === stations.length - 2 ? per + 1 : per;
    for (let k = 0; k < steps; k++) {
      const t = k / per;
      out.push({
        z: spline(p0.z, p1.z, p2.z, p3.z, t),
        y: spline(p0.y, p1.y, p2.y, p3.y, t),
        rx: Math.max(0.0002, spline(p0.rx, p1.rx, p2.rx, p3.rx, t)),
        ry: Math.max(0.0002, spline(p0.ry, p1.ry, p2.ry, p3.ry, t)),
      });
    }
  }
  return out;
}

// Sweeps an ellipse along a spine and stitches the rings into a hull. Radii
// are per station and per axis, so a body can be broader than it is deep
// where the animal's is.
//
// Takes an optional `shade(t, up)` returning a colour, where t runs 0..1 tail
// to bill and up runs -1..1 belly to back. Painting the underside this way
// replaced a second, thinner hull tucked inside the first: that left a hard
// crease down the flank where the inner one broke the surface, which at any
// size above a sparrow reads as a join in a toy.
export function loft(stations, segments = 16, shade = null) {
  const spine = smoothSpine(stations);
  const positions = [];
  const colors = [];
  const indices = [];
  const colour = new THREE.Color();
  for (let i = 0; i < spine.length; i++) {
    const station = spine[i];
    const t = i / (spine.length - 1);
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const up = Math.sin(angle);
      positions.push(Math.cos(angle) * station.rx, station.y + up * station.ry, station.z);
      if (shade) {
        colour.copy(shade(t, up));
        colors.push(colour.r, colour.g, colour.b);
      }
    }
  }
  for (let i = 0; i < spine.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * segments + s;
      const b = i * segments + ((s + 1) % segments);
      const c = (i + 1) * segments + s;
      const d = (i + 1) * segments + ((s + 1) % segments);
      indices.push(a, c, b, b, c, d);
    }
  }
  const first = spine[0];
  const last = spine[spine.length - 1];
  const frontCap = positions.length / 3;
  positions.push(0, first.y, first.z);
  if (shade) { colour.copy(shade(0, 0)); colors.push(colour.r, colour.g, colour.b); }
  const backCap = positions.length / 3;
  positions.push(0, last.y, last.z);
  if (shade) { colour.copy(shade(1, 0)); colors.push(colour.r, colour.g, colour.b); }
  const base = (spine.length - 1) * segments;
  for (let s = 0; s < segments; s++) {
    indices.push(frontCap, (s + 1) % segments, s);
    indices.push(backCap, base + s, base + ((s + 1) % segments));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (shade) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Blends two colours over a band, for the back-to-belly gradient every bird
// here wants. `edge` is where the waterline sits and `soft` how wide the
// transition is: a hard line reads as paint, a very soft one reads as grey.
function twoTone(back, belly, edge = -0.1, soft = 0.5) {
  const a = new THREE.Color(back);
  const b = new THREE.Color(belly);
  const out = new THREE.Color();
  return (t, up) => {
    const k = THREE.MathUtils.clamp((up - edge) / soft + 0.5, 0, 1);
    return out.copy(b).lerp(a, k * k * (3 - 2 * k));
  };
}

// One flight feather: a long tapered blade running out along -Z from its root,
// cambered along its length and cupped across it. Feathers are what make a
// wing read as a wing rather than as a fin, and they have to be separate
// objects so a folded wing can stack them and an open one can spread them.
export function featherGeometry(length, width, tipWidth = width * 0.5) {
  const SEGMENTS = 9;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    // A real feather has a real width where it leaves the shaft, is widest
    // about a third out, and keeps most of that width almost to the end before
    // rounding off. The first profile started from a point at the root and
    // tapered to a quarter width, which is a bristle -- eight of those side by
    // side is a fringe, not a wing, and that is what made the pigeon and the
    // gull read as though they had whiskers coming out of their backs.
    const rise = Math.min(1, t / 0.3);
    const fall = Math.max(0, (t - 0.3) / 0.7);
    const round = 1 - fall * fall * fall * fall;
    const halfWidth = 0.5 * round * (width * 0.62 + (width - width * 0.62) * rise
      - (width - tipWidth) * fall * 0.55);
    const drop = -t * t * length * 0.14;
    const cup = -halfWidth * 0.24;
    positions.push(0, drop, -t * length);
    positions.push(halfWidth, drop + cup, -t * length);
    positions.push(-halfWidth, drop + cup, -t * length);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
    indices.push(a, a + 2, b, a + 2, b + 2, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const standard = (color, roughness = 0.8, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// One material for a whole vertex-painted hull.
const paintedMat = (roughness) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness });

// A pair of mandibles. Every bill here is built as two, because a single cone
// is the giveaway that nobody looked at a bird -- the gape line between upper
// and lower is most of what makes a head read as a head.
function billPair(upper, lower, material, segments = 8) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(loft(upper, segments), material));
  group.add(new THREE.Mesh(loft(lower, segments), material));
  return group;
}

// Eyes, with a catchlight and an optional ring. The ring matters for the gull:
// a red orbital ring on a white head is one of the two things you actually
// recognise a ウミネコ by, the other being the bill.
function eyes(group, { x, y, z, radius, color, ring, ringColor }) {
  const eyeMat = standard(color, 0.2);
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const side of [-1, 1]) {
    if (ring) {
      // A torus round the eye, not a larger sphere behind it. The sphere shows
      // as a bead sitting beside the eye from every angle except dead on.
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.10, radius * 0.17, 6, 16), standard(ringColor, 0.5)
      );
      rim.position.set(side * x * 1.02, y, z * 1.02);
      rim.lookAt(side * x * 6, y, z * 6);
      group.add(rim);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), eyeMat);
    eye.position.set(side * x, y, z);
    group.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.3, 6, 5), shineMat);
    shine.position.set(side * x * 1.06, y + radius * 0.38, z + radius * 0.68);
    group.add(shine);
  }
}

// A wing, as a pivot holding a fan of flight feathers plus a covert over their
// roots. Two nested groups, because the two motions are about different axes:
// the outer pivot beats up and down about the fore-aft axis, the inner one
// swings the feathers from lying along the body round to sticking out
// sideways. Composing both in one Euler is how a set of umbrella ribs once
// ended up pointing in eight directions at once.
function buildWing(side, spec, materials) {
  const pivot = new THREE.Group();
  pivot.position.set(side * spec.root[0], spec.root[1], spec.root[2]);
  pivot.userData.side = side;
  const spread = new THREE.Group();
  pivot.add(spread);
  pivot.userData.spread = spread;

  // A folded wing is not a fan of separated feathers. It is a smooth teardrop
  // lying along the flank with the primary tips crossing past its point, and
  // the individual feathers show only as fine edges. Drawing it as a fan gave
  // the pigeon and the gull a flat plate on the back with two long blades
  // sticking out behind like a swallow's tail.
  //
  // So there are two wings here and only one is visible at a time: a lofted
  // shell for the closed wing, and the fan for the open one. Crossing between
  // them is what `setWingSpread` does.
  const shell = new THREE.Group();
  spread.add(shell);
  const closed = new THREE.Mesh(loft(spec.shell, 12), materials.covert);
  closed.scale.x = spec.shellFlat;
  closed.castShadow = true;
  shell.add(closed);

  // The primaries that reach past the closed wing's point, as three narrow
  // blades laid almost on top of each other. Almost: a real folded wing shows
  // two or three edges, not a single spike and not a fringe.
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const quill = new THREE.Mesh(
      featherGeometry(spec.primary * (1 - t * 0.13), spec.primaryWidth * (1 - t * 0.12)),
      i === 0 ? materials.tip : materials.flight
    );
    quill.position.set(
      side * (spec.primaryAt[0] + t * 0.0016),
      spec.primaryAt[1] - t * spec.primaryStack,
      spec.primaryAt[2]
    );
    quill.rotation.set(spec.primaryTilt, side * (0.02 + t * 0.02), side * (0.05 - t * 0.02));
    quill.castShadow = true;
    shell.add(quill);
  }

  const fan = new THREE.Group();
  fan.visible = false;
  spread.add(fan);
  pivot.userData.shell = shell;
  pivot.userData.fan = fan;

  for (let i = 0; i < spec.count; i++) {
    const t = i / (spec.count - 1);
    // Innermost short and broad, outermost long and narrow: the difference
    // between secondaries and primaries, and the reason an open wing tapers to
    // a point rather than ending square.
    const feather = new THREE.Mesh(
      featherGeometry(spec.inner + t * (spec.outer - spec.inner), spec.width * (1 - t * spec.narrow)),
      t > spec.tipFrom ? materials.tip : materials.flight
    );
    feather.position.set(
      side * (spec.lay[0] + t * spec.layStep[0]),
      spec.lay[1] + t * spec.layStep[1],
      spec.lay[2] + t * spec.layStep[2]
    );
    feather.rotation.set(
      spec.tilt[0] + t * spec.tiltStep[0],
      side * (spec.tilt[1] + t * spec.tiltStep[1]),
      side * (spec.tilt[2] + t * spec.tiltStep[2])
    );
    feather.castShadow = true;
    fan.add(feather);
  }
  return pivot;
}

// Opens or closes a wing. 0 is folded along the flank, 1 is fully out.
export function setWingSpread(pivot, amount) {
  const folded = amount < 0.22;
  pivot.userData.shell.visible = folded;
  pivot.userData.fan.visible = !folded;
  pivot.userData.spread.rotation.y = pivot.userData.side * amount * 1.15;
}

function buildTail(spec, materials) {
  const tail = new THREE.Group();
  tail.position.set(0, spec.at[0], spec.at[1]);
  tail.rotation.x = spec.pitch;
  const half = (spec.count - 1) / 2;
  for (let i = 0; i < spec.count; i++) {
    const spread = (i - half) / half;
    const feather = new THREE.Mesh(
      // A square tail (pigeon) keeps its length out to the edge; a notched or
      // pointed one (flycatcher) loses it.
      featherGeometry(spec.length - Math.abs(spread) * spec.shorten, spec.width),
      Math.abs(spread) > 0.7 ? materials.tip : materials.flight
    );
    feather.rotation.set(0, spread * spec.fan, spread * spec.roll);
    feather.position.set(spread * spec.step, -Math.abs(spread) * spec.droop, 0);
    feather.castShadow = true;
    tail.add(feather);
  }
  return tail;
}

// Legs. A perching bird gets three toes forward and one back, which is what
// makes it look gripped to a surface rather than balanced on pegs; a gull gets
// webbing between the front three instead, because it is a swimmer standing on
// sand and its foot is a paddle.
function buildLegs(group, spec, material) {
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * spec.at[0], spec.at[1], spec.at[2]);
    legs.push(leg);

    const tarsus = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.thickness * 0.85, spec.thickness, spec.tarsus, 6), material
    );
    tarsus.position.y = -spec.tarsus / 2;
    leg.add(tarsus);
    const foot = -spec.tarsus - spec.thickness * 0.4;

    const toes = spec.webbed
      ? [[0, spec.toe], [0.62, spec.toe * 0.94], [-0.62, spec.toe * 0.94]]
      : [[0, spec.toe], [0.55, spec.toe * 0.9], [-0.55, spec.toe * 0.9], [Math.PI, spec.toe * 0.72]];
    for (const [angle, length] of toes) {
      const toe = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.thickness * 0.62, spec.thickness * 0.42, length, 5), material
      );
      toe.position.set(Math.sin(angle) * length * 0.45, foot, Math.cos(angle) * length * 0.45);
      toe.rotation.set(Math.cos(angle) * 1.45, 0, -Math.sin(angle) * 1.45);
      leg.add(toe);
    }
    if (spec.webbed) {
      // The web, as a flat triangle fan between the three forward toes. Two
      // panels rather than one, so the trailing edge is scalloped the way a
      // real foot's is instead of straight across.
      for (const wedge of [1, -1]) {
        const web = new THREE.Mesh(
          new THREE.CircleGeometry(spec.toe * 0.86, 6, 0, Math.PI * 0.34),
          new THREE.MeshStandardMaterial({ color: material.color, roughness: 0.7, side: THREE.DoubleSide })
        );
        web.rotation.x = -Math.PI / 2;
        web.rotation.z = wedge * 0.34 - Math.PI * 0.17;
        web.position.set(0, foot - spec.thickness * 0.3, spec.toe * 0.12);
        leg.add(web);
      }
    }
    group.add(leg);
  }
  return legs;
}

// Finishes a bird: hangs the shared handles the animation code reaches for,
// and measures how far the toes sit below the group origin so the game can
// stand it on the ground. Measured, not declared -- the first pass wrote the
// belly height into that field by mistake and the gull floated six centimetres
// over the sand, which at 47cm long is most of a leg.
function finish(group, { wings, legs, perchOnHer, length, label }) {
  group.updateWorldMatrix(true, true);
  let toes = Infinity;
  for (const leg of legs) toes = Math.min(toes, new THREE.Box3().setFromObject(leg).min.y);
  const groundY = Number.isFinite(toes) ? -toes : 0;
  group.userData.leftWing = wings[0];
  group.userData.rightWing = wings[1];
  group.userData.legs = legs;
  group.userData.groundY = groundY;
  group.userData.perchOnHer = perchOnHer;
  group.userData.length = length;
  group.userData.label = label;
  group.visible = false;
  return group;
}

// ---- オオルリ / small woodland flycatcher, 14cm ----
// The park bird. Deep blue above, pale below: the strongest small-bird pattern
// there is, and it has to read at three metres in a frame that is about
// somebody else. Small enough and tame enough in this story to come to a hand.
function makeFlycatcher() {
  const group = new THREE.Group();
  const materials = {
    back: standard(0x3d6fb0, 0.78),
    belly: standard(0xf2f1e6, 0.85),
    flight: standard(0x24447d, 0.7, { side: THREE.DoubleSide }),
    tip: standard(0x172b52, 0.7, { side: THREE.DoubleSide }),
    covert: standard(0x3d6fb0, 0.78),
  };
  const painted = paintedMat(0.8);
  const beakMat = standard(0x2b2f38, 0.45);
  const legMat = standard(0xb07a41, 0.65);

  // Perched, not flying: tail low and back, chest carried forward, head well
  // above the shoulders on a short neck. A level spine made it lie on the
  // grass like something dropped, and a body as wide as it was deep turned a
  // songbird into a wader. A small bird is narrow across and deep through.
  const BODY = [
    { z: -0.034, y: 0.004, rx: 0.006, ry: 0.006 },
    { z: -0.025, y: 0.008, rx: 0.014, ry: 0.015 },
    { z: -0.013, y: 0.012, rx: 0.019, ry: 0.023 },
    { z: -0.001, y: 0.016, rx: 0.021, ry: 0.026 },
    { z: 0.009, y: 0.023, rx: 0.020, ry: 0.025 },
    { z: 0.014, y: 0.034, rx: 0.016, ry: 0.018 },
    { z: 0.017, y: 0.045, rx: 0.015, ry: 0.016 },
    { z: 0.021, y: 0.055, rx: 0.017, ry: 0.017 },
    { z: 0.030, y: 0.060, rx: 0.016, ry: 0.016 },
    { z: 0.038, y: 0.059, rx: 0.011, ry: 0.011 },
    { z: 0.042, y: 0.057, rx: 0.006, ry: 0.006 },
  ];
  const body = new THREE.Mesh(
    loft(BODY, 22, twoTone(0x3d6fb0, 0xf2f1e6, -0.15, 0.55)), painted
  );
  body.castShadow = true;
  group.add(body);

  // Carried level, not drooping. Following the head's own downward taper made
  // it point at the ground, which reads as probing for insects rather than as
  // a bird sitting still.
  group.add(billPair([
    { z: 0.0405, y: 0.0582, rx: 0.0058, ry: 0.0046 },
    { z: 0.0465, y: 0.0578, rx: 0.0038, ry: 0.0032 },
    { z: 0.0515, y: 0.0566, rx: 0.0015, ry: 0.0015 },
    { z: 0.0540, y: 0.0554, rx: 0.0005, ry: 0.0005 },
  ], [
    { z: 0.0405, y: 0.0546, rx: 0.0050, ry: 0.0032 },
    { z: 0.0460, y: 0.0546, rx: 0.0030, ry: 0.0021 },
    { z: 0.0505, y: 0.0548, rx: 0.0008, ry: 0.0008 },
  ], beakMat));

  eyes(group, { x: 0.0132, y: 0.0632, z: 0.0300, radius: 0.0046, color: 0x14161c });

  const wings = [];
  for (const side of [-1, 1]) {
    const wing = buildWing(side, {
      root: [0.013, 0.034, 0.004],
      shell: [
        { z: 0.010, y: 0.000, rx: 0.006, ry: 0.005 },
        { z: -0.002, y: -0.004, rx: 0.011, ry: 0.013 },
        { z: -0.018, y: -0.010, rx: 0.010, ry: 0.013 },
        { z: -0.034, y: -0.016, rx: 0.006, ry: 0.008 },
        { z: -0.046, y: -0.020, rx: 0.002, ry: 0.003 },
      ],
      shellFlat: 0.55,
      primary: 0.030, primaryWidth: 0.008,
      primaryAt: [0.002, -0.016, -0.040], primaryStack: 0.0018, primaryTilt: -0.10,
      count: 8, inner: 0.028, outer: 0.050, width: 0.010, narrow: 0.30, tipFrom: 0.6,
      lay: [0.001, -0.003, -0.004], layStep: [0.002, -0.006, -0.006],
      // Barely fanned. Splayed wide they stopped being a closed wing and
      // became a handful of spikes coming out of its side.
      tilt: [-0.03, 0.05, 0.16], tiltStep: [-0.09, -0.07, -0.05],
    }, materials);
    group.add(wing);
    wings.push(wing);
  }

  group.add(buildTail({
    at: [0.004, -0.032], pitch: 0.13, count: 6,
    length: 0.045, shorten: 0.004, width: 0.014,
    fan: 0.12, roll: 0.14, step: 0.0032, droop: 0.0007,
  }, materials));

  const legs = buildLegs(group, {
    at: [0.009, -0.006, 0.003], tarsus: 0.027, toe: 0.012, thickness: 0.0024,
  }, legMat);

  return finish(group, {
    wings, legs, perchOnHer: true, length: 0.14, label: 'オオルリ',
  });
}

// ---- ドバト / feral pigeon, 33cm ----
// The street bird, and the one everybody has actually stood next to. What
// makes a pigeon a pigeon, from the field guide rather than from memory: a
// very deep chest carried low and forward, a small round head on a short thick
// neck, a slender dark bill with a white cere swollen over its base, a broad
// square tail, and short red legs. Scaling the flycatcher up 2.4x gives none
// of that -- it gives a giant sparrow.
function makePigeon() {
  const group = new THREE.Group();
  const materials = {
    back: standard(0x7d858f, 0.82),
    belly: standard(0x99a1aa, 0.85),
    flight: standard(0x5f6771, 0.74, { side: THREE.DoubleSide }),
    tip: standard(0x3c424b, 0.74, { side: THREE.DoubleSide }),
    covert: standard(0x767e88, 0.82),
  };
  // The neck's green-purple sheen, which is the one flash of colour on the
  // bird and the thing your eye goes to. Low roughness plus a warm emissive
  // is a cheap stand-in for iridescence that holds up at three metres.
  const neckMat = new THREE.MeshStandardMaterial({
    color: 0x4e7f6a, roughness: 0.3, metalness: 0.42, emissive: 0x2a1f3c, emissiveIntensity: 0.35,
  });
  const painted = paintedMat(0.82);
  const beakMat = standard(0x3a3d44, 0.5);
  const cereMat = standard(0xe8e6e0, 0.9);
  const legMat = standard(0xc4645e, 0.6);

  // 33cm bill tip to tail tip. Chest deepest well forward and hanging below
  // the leg line, which is the pigeon's whole profile.
  const BODY = [
    { z: -0.085, y: 0.030, rx: 0.012, ry: 0.012 },
    { z: -0.062, y: 0.028, rx: 0.030, ry: 0.031 },
    { z: -0.035, y: 0.026, rx: 0.045, ry: 0.050 },
    { z: -0.008, y: 0.026, rx: 0.052, ry: 0.060 },
    { z: 0.018, y: 0.031, rx: 0.051, ry: 0.061 },
    { z: 0.040, y: 0.043, rx: 0.043, ry: 0.052 },
    // The neck: short and thick, and it barely narrows. A waisted neck here
    // was the single thing that kept the model reading as a songbird.
    { z: 0.052, y: 0.066, rx: 0.030, ry: 0.032 },
    { z: 0.057, y: 0.086, rx: 0.026, ry: 0.027 },
    { z: 0.062, y: 0.103, rx: 0.026, ry: 0.026 },
    // The head: small, round, with a steep forehead over the bill.
    { z: 0.074, y: 0.115, rx: 0.025, ry: 0.025 },
    { z: 0.088, y: 0.118, rx: 0.022, ry: 0.022 },
    { z: 0.099, y: 0.114, rx: 0.014, ry: 0.014 },
    { z: 0.104, y: 0.108, rx: 0.006, ry: 0.006 },
  ];
  const body = new THREE.Mesh(
    loft(BODY, 24, twoTone(0x7d858f, 0xa8afb7, -0.25, 0.75)), painted
  );
  body.castShadow = true;
  group.add(body);

  // The iridescent collar, as a sleeve over the neck stations. Kept as its own
  // mesh because it is the one part of the bird that is not diffuse.
  const collar = BODY.slice(6, 10).map((st) => ({
    z: st.z, y: st.y, rx: st.rx * 1.03, ry: st.ry * 1.03,
  }));
  group.add(new THREE.Mesh(loft(collar, 20), neckMat));

  // A slender dark bill with the cere swollen white over its base. Without the
  // cere the head reads as a dove's; it is a small piece of geometry doing a
  // lot of identifying work.
  group.add(billPair([
    { z: 0.1015, y: 0.1106, rx: 0.0060, ry: 0.0052 },
    { z: 0.1120, y: 0.1094, rx: 0.0044, ry: 0.0040 },
    { z: 0.1215, y: 0.1068, rx: 0.0026, ry: 0.0026 },
    { z: 0.1265, y: 0.1044, rx: 0.0008, ry: 0.0008 },
  ], [
    { z: 0.1015, y: 0.1042, rx: 0.0052, ry: 0.0034 },
    { z: 0.1120, y: 0.1042, rx: 0.0034, ry: 0.0024 },
    { z: 0.1205, y: 0.1046, rx: 0.0012, ry: 0.0012 },
  ], beakMat, 10));
  const cere = new THREE.Mesh(loft([
    { z: 0.0975, y: 0.1128, rx: 0.0068, ry: 0.0050 },
    { z: 0.1030, y: 0.1136, rx: 0.0080, ry: 0.0062 },
    { z: 0.1085, y: 0.1126, rx: 0.0052, ry: 0.0040 },
  ], 10), cereMat);
  group.add(cere);

  // Orange-red iris with a small dark pupil, set high on a small head.
  eyes(group, {
    x: 0.0208, y: 0.1192, z: 0.0868, radius: 0.0040,
    color: 0x1b1c20, ring: true, ringColor: 0xba7c33,
  });

  const wings = [];
  for (const side of [-1, 1]) {
    const wing = buildWing(side, {
      root: [0.033, 0.062, 0.008],
      shell: [
        { z: 0.026, y: 0.000, rx: 0.014, ry: 0.012 },
        { z: 0.004, y: -0.008, rx: 0.028, ry: 0.032 },
        { z: -0.030, y: -0.020, rx: 0.028, ry: 0.034 },
        { z: -0.066, y: -0.032, rx: 0.018, ry: 0.024 },
        { z: -0.092, y: -0.040, rx: 0.007, ry: 0.010 },
      ],
      shellFlat: 0.50,
      // Folded, a pigeon's wingtips reach about the end of the tail.
      primary: 0.095, primaryWidth: 0.021,
      primaryAt: [0.004, -0.038, -0.086], primaryStack: 0.0035, primaryTilt: -0.09,
      // Broad, blunt-tipped wings: a pigeon's are built for a fast clattering
      // take-off, not for gliding, so they are much wider than a gull's.
      count: 10, inner: 0.062, outer: 0.118, width: 0.026, narrow: 0.34, tipFrom: 0.62,
      lay: [0.002, -0.006, -0.010], layStep: [0.005, -0.014, -0.014],
      tilt: [-0.02, 0.04, 0.13], tiltStep: [-0.07, -0.06, -0.04],
    }, materials);
    group.add(wing);
    wings.push(wing);
  }

  group.add(buildTail({
    at: [0.030, -0.082], pitch: 0.10, count: 8,
    // Square-ended: the outer feathers keep almost all their length, which is
    // what gives a walking pigeon its blunt back end.
    length: 0.108, shorten: 0.004, width: 0.034,
    fan: 0.13, roll: 0.08, step: 0.0080, droop: 0.0010,
  }, materials));

  // Short legs, set well back under the deep chest.
  const legs = buildLegs(group, {
    at: [0.021, 0.002, 0.004], tarsus: 0.030, toe: 0.026, thickness: 0.0060,
  }, legMat);

  return finish(group, {
    wings, legs, perchOnHer: false, length: 0.33, label: 'ドバト',
  });
}

// ---- ウミネコ / black-tailed gull, 47cm, wingspan 120cm ----
// The beach bird. Two features carry the identification and both are built
// explicitly: a long straight yellow bill with a black band and a red tip, and
// a white tail with a black band across it -- the 尾 that gives the bird its
// name. Slate-grey back over a white body, yellow legs, red orbital ring.
// The silhouette is the other half: long narrow wings on a streamlined body,
// nothing like the pigeon's barrel.
function makeGull() {
  const group = new THREE.Group();
  const materials = {
    back: standard(0x53606b, 0.76),
    belly: standard(0xf7f8f8, 0.84),
    flight: standard(0x46525c, 0.72, { side: THREE.DoubleSide }),
    tip: standard(0x24292f, 0.72, { side: THREE.DoubleSide }),
    covert: standard(0x53606b, 0.76),
  };
  const painted = paintedMat(0.8);
  const whiteMat = standard(0xf7f8f8, 0.84);
  const billMat = standard(0xe8b93c, 0.45);
  const bandMat = standard(0x2a2b2e, 0.5);
  const redMat = standard(0xcc3b2c, 0.45);
  const legMat = standard(0xe0b840, 0.6);

  // 47cm bill tip to tail tip. Long and level through the body, with the head
  // carried forward rather than stacked over the shoulders -- a standing gull
  // is a horizontal bird, which is most of why it does not read as a big dove.
  const BODY = [
    { z: -0.130, y: 0.062, rx: 0.014, ry: 0.014 },
    { z: -0.100, y: 0.060, rx: 0.034, ry: 0.036 },
    { z: -0.062, y: 0.058, rx: 0.050, ry: 0.056 },
    { z: -0.024, y: 0.058, rx: 0.056, ry: 0.064 },
    { z: 0.012, y: 0.062, rx: 0.054, ry: 0.062 },
    { z: 0.044, y: 0.072, rx: 0.044, ry: 0.050 },
    { z: 0.068, y: 0.092, rx: 0.031, ry: 0.033 },
    { z: 0.082, y: 0.114, rx: 0.027, ry: 0.028 },
    { z: 0.094, y: 0.134, rx: 0.028, ry: 0.028 },
    // A flat-crowned head, not a ball. A gull's skull is long front to back.
    { z: 0.114, y: 0.146, rx: 0.027, ry: 0.026 },
    { z: 0.136, y: 0.148, rx: 0.024, ry: 0.023 },
    { z: 0.152, y: 0.143, rx: 0.015, ry: 0.015 },
    { z: 0.158, y: 0.137, rx: 0.007, ry: 0.007 },
  ];
  // White comes up much higher on a gull than on the other two: the whole
  // head, neck and underside are white and only the mantle -- the saddle
  // between the wings -- is grey. So the gradient is not a simple waterline;
  // it fades to white towards the head as well as downwards.
  const slate = new THREE.Color(0x53606b);
  const white = new THREE.Color(0xf7f8f8);
  const mix = new THREE.Color();
  const gullShade = (t, up) => {
    const high = THREE.MathUtils.clamp((up + 0.05) / 0.6 + 0.5, 0, 1);
    // t runs tail to bill; the mantle stops at the base of the neck.
    const behind = THREE.MathUtils.clamp((0.62 - t) / 0.16, 0, 1);
    const k = high * high * (3 - 2 * high) * behind;
    return mix.copy(white).lerp(slate, k);
  };
  const body = new THREE.Mesh(loft(BODY, 24, gullShade), painted);
  body.castShadow = true;
  group.add(body);

  // The bill: long, straight, heavy, with a slight hook dropped at the tip of
  // the upper mandible. Built in three materials along its length so the black
  // band and red tip are geometry rather than a wish.
  group.add(billPair([
    { z: 0.1545, y: 0.1408, rx: 0.0090, ry: 0.0082 },
    { z: 0.1700, y: 0.1400, rx: 0.0078, ry: 0.0072 },
    { z: 0.1850, y: 0.1388, rx: 0.0068, ry: 0.0064 },
  ], [
    { z: 0.1545, y: 0.1330, rx: 0.0082, ry: 0.0056 },
    { z: 0.1700, y: 0.1330, rx: 0.0070, ry: 0.0050 },
    { z: 0.1840, y: 0.1332, rx: 0.0058, ry: 0.0044 },
  ], billMat, 10));
  const band = new THREE.Mesh(loft([
    { z: 0.1850, y: 0.1370, rx: 0.0072, ry: 0.0098 },
    { z: 0.1930, y: 0.1368, rx: 0.0070, ry: 0.0096 },
  ], 10), bandMat);
  group.add(band);
  const tip = new THREE.Mesh(loft([
    { z: 0.1930, y: 0.1368, rx: 0.0068, ry: 0.0094 },
    { z: 0.2010, y: 0.1360, rx: 0.0056, ry: 0.0072 },
    // The hook: the very tip drops below the line of the bill.
    { z: 0.2065, y: 0.1330, rx: 0.0028, ry: 0.0034 },
  ], 10), redMat);
  group.add(tip);

  // Pale yellow iris in a red orbital ring -- the ウミネコ's face, and worth
  // the four extra spheres.
  eyes(group, {
    x: 0.0232, y: 0.1512, z: 0.1305, radius: 0.0056,
    color: 0xd8cf7a, ring: true, ringColor: 0xa8453a,
  });

  const wings = [];
  for (const side of [-1, 1]) {
    const wing = buildWing(side, {
      root: [0.036, 0.098, 0.010],
      shell: [
        { z: 0.030, y: 0.000, rx: 0.016, ry: 0.012 },
        { z: 0.002, y: -0.008, rx: 0.030, ry: 0.032 },
        { z: -0.040, y: -0.020, rx: 0.030, ry: 0.034 },
        { z: -0.086, y: -0.032, rx: 0.019, ry: 0.024 },
        { z: -0.120, y: -0.040, rx: 0.007, ry: 0.009 },
      ],
      shellFlat: 0.48,
      // A gull's folded wingtips cross past the end of the tail, which is
      // most of what tells its silhouette from a duck's at rest.
      primary: 0.145, primaryWidth: 0.022,
      primaryAt: [0.004, -0.038, -0.112], primaryStack: 0.004, primaryTilt: -0.07,
      // 120cm across the wings on a 47cm bird: long and narrow, and the
      // outermost primaries far longer than the innermost secondaries. Folded
      // they cross well past the tail, which is the gull at rest.
      count: 11, inner: 0.075, outer: 0.235, width: 0.028, narrow: 0.52, tipFrom: 0.66,
      lay: [0.002, -0.006, -0.012], layStep: [0.006, -0.016, -0.018],
      tilt: [-0.02, 0.03, 0.10], tiltStep: [-0.05, -0.05, -0.03],
    }, materials);
    group.add(wing);
    wings.push(wing);
  }

  // A white tail with a black band across it. Built as white feathers with a
  // separate dark bar laid over them rather than as dark feathers, because the
  // band sits partway along and stops short of the tip.
  const tailMat = standard(0xe4e8ec, 0.82, { side: THREE.DoubleSide });
  const tail = buildTail({
    at: [0.062, -0.126], pitch: 0.08, count: 8,
    length: 0.112, shorten: 0.006, width: 0.034,
    fan: 0.14, roll: 0.08, step: 0.0090, droop: 0.0010,
  }, { flight: tailMat, tip: tailMat });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.0030, 0.020), bandMat);
  bar.position.set(0, -0.0125, -0.076);
  tail.add(bar);
  group.add(tail);

  // Longer, yellow, webbed. A gull stands taller than a pigeon and the feet
  // are paddles, which shows most when it is standing on wet sand.
  const legs = buildLegs(group, {
    at: [0.020, 0.030, -0.010], tarsus: 0.050, toe: 0.032, thickness: 0.0068, webbed: true,
  }, legMat);

  return finish(group, {
    wings, legs, perchOnHer: false, length: 0.47, label: 'ウミネコ',
  });
}

export const BIRDS = {
  flycatcher: makeFlycatcher,
  pigeon: makePigeon,
  gull: makeGull,
};

// Which bird belongs where. A gull inland or a flycatcher on a shopping street
// would both be wrong in the way that a wrongly-sized bench is wrong.
export const SCENE_BIRD = { park: 'flycatcher', street: 'pigeon', beach: 'gull' };

// ---- スナガニ / ghost crab, 3cm across ----
// The beach's second animal, and the one that makes the sand read as a living
// place rather than as a floor. 甲幅 about 2.5-3cm, a nearly square carapace,
// eyes on tall stalks standing straight up off the top of it, and claws of
// unequal size. It runs sideways, very fast, and stops dead.
//
// Built with jointed legs -- merus out, carpus down, dactyl to a point --
// because the thing that makes a crab a crab is that its legs bend twice and
// carry the shell slung underneath them. Eight straight spokes off a disc is a
// spider, and a dome with spokes is a beetle.
export function makeCrab() {
  const group = new THREE.Group();
  const shellMat = standard(0xd9c39a, 0.72);
  const paleMat = standard(0xeadfc4, 0.75);
  const jointMat = standard(0xcbb187, 0.7);
  const eyeMat = standard(0x1a1a1e, 0.25);

  const WIDTH = 0.029;      // 甲幅 -- the measurement the field guide gives
  const LENGTH = 0.024;
  const HEIGHT = 0.011;

  // The carapace: a dome pushed towards a rectangle. A ghost crab's shell is
  // nearly square in plan with rounded corners and a flat underside, so
  // neither a box nor a squashed sphere is right on its own -- the first pass
  // used a box and it read as a matchbox on legs. This takes a sphere and
  // pulls its vertices out to a superellipse in plan, which squares the sides
  // while keeping the dome and the rounded corners.
  const shellGeo = new THREE.SphereGeometry(0.5, 28, 16);
  {
    const p = shellGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z);
      if (r > 1e-6) {
        // Superellipse of order 4: |x|^4 + |z|^4 = 1, which is a rounded square.
        const cx = v.x / r; const cz = v.z / r;
        const k = 1 / Math.pow(Math.pow(Math.abs(cx), 4) + Math.pow(Math.abs(cz), 4), 0.25);
        v.x *= k; v.z *= k;
      }
      v.x *= WIDTH; v.z *= LENGTH;
      // Flat underneath, domed on top, and the dome lower at the back.
      v.y = v.y > 0 ? v.y * HEIGHT * 2 * (1 - Math.max(0, -v.z / LENGTH) * 0.22) : v.y * HEIGHT * 0.5;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    shellGeo.computeVertexNormals();
  }
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.y = 0.0115;
  shell.castShadow = true;
  group.add(shell);

  // The front edge between the eye stalks is squared off and slightly raised,
  // and there is a notch each side where the stalks fold down.
  const brow = new THREE.Mesh(new THREE.BoxGeometry(WIDTH * 0.40, 0.0018, 0.0022), shellMat);
  brow.position.set(0, 0.0136, LENGTH * 0.42);
  group.add(brow);

  const apron = new THREE.Mesh(new THREE.BoxGeometry(WIDTH * 0.52, 0.0035, LENGTH * 0.5), paleMat);
  apron.position.set(0, 0.0068, -0.0015);
  group.add(apron);

  // Eye stalks, straight up off the front of the shell with the eye as a
  // capsule on top. Ghost crabs carry them like periscopes and it is the
  // silhouette people recognise them by.
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0015, 0.0092, 7), paleMat);
    stalk.position.set(side * 0.0068, 0.0198, 0.0092);
    group.add(stalk);
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.0018, 0.0024, 4, 10), eyeMat);
    eye.position.set(side * 0.0068, 0.0258, 0.0092);
    group.add(eye);
  }

  // Claws, unequal -- 雌雄ともはさみ脚は左右で大きさが異なる. Each is a chain of
  // nested groups: an arm out from the body, a forearm angled forward, then a
  // hand whose two fingers meet at a point with a gap behind them. Nested
  // rather than one Euler per part, because two rotations composed in a single
  // Euler is how a set of umbrella ribs once ended up pointing eight ways.
  const claws = [];
  for (const [side, size] of [[-1, 1.0], [1, 0.7]]) {
    const arm = new THREE.Group();
    arm.position.set(side * WIDTH * 0.42, 0.0102, LENGTH * 0.3);
    arm.rotation.y = -side * 0.55;

    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0021 * size, 0.0027 * size, 0.0105, 7), jointMat
    );
    upper.rotation.z = -Math.PI / 2;
    upper.position.x = side * 0.0052;
    arm.add(upper);

    const fore = new THREE.Group();
    fore.position.x = side * 0.0104;
    fore.rotation.y = -side * 1.05;
    arm.add(fore);

    const wrist = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0026 * size, 0.0021 * size, 0.0072, 7), jointMat
    );
    wrist.rotation.z = -Math.PI / 2;
    wrist.position.x = side * 0.0036;
    fore.add(wrist);

    const hand = new THREE.Group();
    hand.position.x = side * 0.0072;
    fore.add(hand);
    // The palm, deeper than it is wide -- a crab's claw is a flattened blade.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.0040 * size, 10, 8), paleMat);
    palm.scale.set(1.5, 0.78, 1.0);
    hand.add(palm);
    // Fixed finger below, movable dactyl above, closed to a point.
    for (const [lift, tilt] of [[0.0018, -0.13], [-0.0016, 0.11]]) {
      const digit = new THREE.Mesh(new THREE.ConeGeometry(0.0014 * size, 0.0080 * size, 7), paleMat);
      digit.rotation.z = -side * (Math.PI / 2) + tilt;
      digit.position.set(side * 0.0056 * size, lift * size, 0);
      hand.add(digit);
    }
    arm.castShadow = true;
    group.add(arm);
    claws.push(arm);
  }

  // Four pairs of walking legs. Each bends twice -- merus out and up, carpus
  // down, then a pointed dactyl on the sand -- and the shell hangs between
  // them rather than sitting on top of them. Eight straight spokes off a disc
  // is a spider; the double bend is the whole difference.
  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const leg = new THREE.Group();
      leg.position.set(side * WIDTH * 0.44, 0.0098, LENGTH * (0.24 - t * 0.62));
      // Front pair reaches forward, back pair trails: the fan is what stops
      // eight legs reading as a single fringe under the shell.
      leg.rotation.y = -side * (0.62 - t * 1.34);
      const reach = 0.0125 - Math.abs(t - 0.4) * 0.0032;

      // Merus: out from the body and angled up, so the knee stands above the
      // shell. This is the pose a crab actually holds, and it is why a crab
      // looks like it is crouching over the sand rather than lying on it.
      const merus = new THREE.Group();
      merus.rotation.z = side * 0.62;
      leg.add(merus);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0013, reach, 6), jointMat);
      m.rotation.z = -Math.PI / 2;
      m.position.x = side * reach * 0.5;
      merus.add(m);

      // Carpus: from the knee, back down past the level of the shell.
      const carpus = new THREE.Group();
      carpus.position.x = side * reach;
      carpus.rotation.z = -side * 1.42;
      merus.add(carpus);
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0012, 0.0009, reach * 0.92, 6), jointMat
      );
      c.rotation.z = -Math.PI / 2;
      c.position.x = side * reach * 0.46;
      carpus.add(c);

      // Dactyl: the pointed tip that actually touches the sand.
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.0009, reach * 0.7, 6), paleMat);
      d.rotation.z = -side * (Math.PI / 2) - side * 0.22;
      d.position.x = side * (reach * 0.92 + reach * 0.3);
      carpus.add(d);

      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);
    }
  }

  group.userData.legs = legs;
  group.userData.claws = claws;
  group.userData.groundY = 0.0;
  group.userData.length = 0.03;
  group.userData.label = 'スナガニ';
  group.visible = false;
  return group;
}
