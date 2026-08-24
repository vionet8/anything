// Costume changes.
//
// The avatar is a VRoid export, and the useful thing about a VRoid export is
// how it is put together: the body is one skinned mesh split by material into
// SKIN / Tops / Bottoms / Shoes, each with its own 768-square texture, and the
// inner layer -- the camisole and the tights she starts in -- is *painted on
// the body texture*, not modelled. The body geometry underneath is complete.
//
// That decides the whole approach:
//
//   outer garments   repaint the Tops and Bottoms textures; the geometry (a
//                    loose cardigan, a pair of shorts) is generic enough to
//                    read as a blazer or a sailor top once it is painted, and
//                    the folds and stitching in the original survive because
//                    the repaint recolours it rather than starting from blank
//   swimwear         hide Tops and Bottoms and paint the swimsuit into the
//                    body texture, where the camisole was
//
// The second one matters for more than convenience. Because the swimsuit is
// painted into the body texture itself, there is no order of operations that
// takes a garment off without another already being on: hiding the outer
// meshes reveals the painted layer, whatever it is. "Undressed" is not a state
// this code can reach.
//
// Where the UV islands are is not guessed. tools/uv_atlas.js rasterises each
// garment's UV triangles colour-coded by the bone that drives them, and the
// atlas is checked by wearing it -- the first attempt had v the wrong way up
// and painted the leg texture onto the arms, which is obvious on the model and
// invisible in the numbers.
import * as THREE from 'three';

const SIZE = 768;

// ---- Where things are on the body texture ----
//
// The torso is one column with her front centre-line down the middle of it and
// her spine at both outer edges: x 185..384 wraps her right half from back to
// front, x 384..582 her left half from front to back. Verified by painting a
// stripe on the seam and finding it running down her sternum.
export const BODY = {
  torso: { x0: 185, x1: 582, front: 384 },
  neck: { y0: 0, y1: 95 },
  chest: { y0: 95, y1: 245 },
  hips: { y0: 245, y1: 400 },
  arms: [{ x0: 0, x1: 178 }, { x0: 590, x1: 768 }],
  armsY: { y0: 0, y1: 370 },
  legs: [{ x0: 0, x1: 178 }, { x0: 590, x1: 768 }],
  thigh: { y0: 375, y1: 540 },
  shin: { y0: 540, y1: 768 },
};

// ---- Canvas helpers ----

function canvasOf(image) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (image) ctx.drawImage(image, 0, 0, SIZE, SIZE);
  return { canvas, ctx };
}

// Recolours a garment by pushing every pixel towards a target hue while
// keeping its own light and shade. Repainting a flat colour over the top
// throws away the folds, the ribbing and the stitching that make the original
// texture look like cloth; this keeps all of it and only changes what colour
// the cloth is.
//
// `strength` 1 replaces the hue outright, lower values tint.
function tintTexture(ctx, target, { gamma = 1, lift = 1 } = {}) {
  const t = new THREE.Color(target);
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = image.data;

  // Two passes. The first measures how light the garment already is, because
  // the recolour has to be *relative*: the naive version multiplied the target
  // colour by the source luminance, which turns a navy target on an already
  // dark hoodie into a black rectangle -- which is exactly what the first
  // blazer came out as. Normalising by the mean makes the average pixel land
  // on the target colour and keeps everything else in proportion to it.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    n++;
  }
  const mean = n ? Math.max(0.06, sum / n) : 0.5;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    // Relative shading, softened so a very dark or very bright original does
    // not blow out: halfway between flat and fully proportional.
    let k = Math.pow(l / mean, gamma);
    k = 1 + (k - 1) * 0.75;
    k *= lift;
    d[i] = Math.min(255, t.r * k * 255);
    d[i + 1] = Math.min(255, t.g * k * 255);
    d[i + 2] = Math.min(255, t.b * k * 255);
  }
  ctx.putImageData(image, 0, 0);
}

// Samples a patch of the source and returns its average colour -- used to find
// the model's own skin tone rather than hard-coding one, so the same code
// works for three characters with three different complexions.
function averageAt(ctx, x, y, w, h) {
  const d = ctx.getImageData(x, y, w, h).data;
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : '#e8c0a0';
}

// Paints bare skin over a region, taking the tone from her own upper arm. The
// legs come out of the box in opaque tights; a swimsuit needs them bare, and
// there is no skin painted underneath to uncover. A flat fill is enough
// because MToon shades the legs in 3D from the normal map -- checked on the
// model, and it reads as skin rather than as a stocking.
function skinOver(ctx, skin, rect) {
  ctx.fillStyle = skin;
  ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
}

// A band around the torso, given as a fraction of the way round from her front
// centre-line. `spread` 0 is the front seam, 1 is the spine. Both halves are
// painted, mirrored, so a garment comes out symmetrical.
function torsoBand(ctx, { y0, y1, spread = 1, fill, radius = 0 }) {
  const { x0, x1, front } = BODY.torso;
  const half = Math.min(front - x0, x1 - front);
  const reach = half * spread;
  ctx.fillStyle = fill;
  for (const dir of [-1, 1]) {
    const left = dir < 0 ? front - reach : front;
    const w = reach;
    if (radius > 0 && ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(left, y0, w, y1 - y0, radius);
      ctx.fill();
    } else {
      ctx.fillRect(left, y0, w, y1 - y0);
    }
  }
}

// A soft edge, so a painted garment does not end on a hard pixel line. Cloth
// against skin has a shadow under it.
function shadeEdge(ctx, y, height, spread = 1) {
  const { x0, x1, front } = BODY.torso;
  const half = Math.min(front - x0, x1 - front);
  const reach = half * spread;
  const grad = ctx.createLinearGradient(0, y, 0, y + height);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(front - reach, y, reach * 2, height);
}

// ---- Swimwear, painted into the body texture ----

// Everything the model wears on its skin, cleared back to her own complexion:
// the camisole across the torso, the tights down both legs, and the lace cuffs
// at the wrists. Missing the cuffs left two black bands round her forearms in
// the first pass, which is the sort of thing that only shows on the model.
function stripToSkin(ctx) {
  const skin = averageAt(ctx, 55, 110, 70, 70);
  for (const block of BODY.legs) {
    skinOver(ctx, skin, { x0: block.x0, y0: BODY.thigh.y0, x1: block.x1, y1: BODY.shin.y1 });
    // A touch darker down the outside of each island, which is where the limb
    // turns away. Flat fill alone left the legs reading as a mannequin's.
    const grad = ctx.createLinearGradient(block.x0, 0, block.x1, 0);
    grad.addColorStop(0, 'rgba(120,78,58,0.16)');
    grad.addColorStop(0.35, 'rgba(120,78,58,0)');
    grad.addColorStop(0.65, 'rgba(120,78,58,0)');
    grad.addColorStop(1, 'rgba(120,78,58,0.16)');
    ctx.fillStyle = grad;
    ctx.fillRect(block.x0, BODY.thigh.y0, block.x1 - block.x0, BODY.shin.y1 - BODY.thigh.y0);
  }
  for (const block of BODY.arms) {
    // Wrists, for the lace cuffs, and the very top of the island, because the
    // camisole's shoulder straps run off the torso onto the arm and left two
    // dark tabs sitting on her shoulders.
    skinOver(ctx, skin, { x0: block.x0, y0: 300, x1: block.x1, y1: BODY.armsY.y1 });
    skinOver(ctx, skin, { x0: block.x0, y0: 0, x1: block.x1, y1: 62 });
  }
  skinOver(ctx, skin, {
    x0: BODY.torso.x0, y0: BODY.neck.y0, x1: BODY.torso.x1, y1: BODY.hips.y1 + 30,
  });
  return skin;
}

// A garment outline given as a profile: for each row, how far round the body
// the cloth reaches, as a fraction from the front seam to the spine. Painting
// swimwear as rounded rectangles gave her something that read as plate armour;
// what makes cloth read as cloth is that its edges are curves that change
// along the body -- a bikini top is wide at the bust and narrows to a strap, a
// brief is deep at the hip and cut away at the front.
function torsoShape(ctx, y0, y1, reachAt, fill) {
  const { front, x0, x1 } = BODY.torso;
  const half = Math.min(front - x0, x1 - front);
  ctx.fillStyle = fill;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(front, y0);
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      ctx.lineTo(front + dir * half * Math.max(0, reachAt(t)), y);
    }
    ctx.lineTo(front, y1);
    ctx.closePath();
    ctx.fill();
  }
}

// The shadow the cloth casts on the skin just below its hem.
function hemShadow(ctx, y, height, reach) {
  const { front, x0, x1 } = BODY.torso;
  const half = Math.min(front - x0, x1 - front);
  const grad = ctx.createLinearGradient(0, y, 0, y + height);
  grad.addColorStop(0, 'rgba(84,52,40,0.30)');
  grad.addColorStop(1, 'rgba(84,52,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(front - half * reach, y, half * reach * 2, height);
}

function paintBikini(ctx, colour, accent) {
  stripToSkin(ctx);
  const chest = BODY.chest;
  const hips = BODY.hips;

  // The top. Full depth over the bust at the front, tapering to a narrow band
  // that carries round the back -- which is what a bikini top actually is.
  const topY0 = chest.y0 + 44;
  const topY1 = chest.y0 + 124;
  torsoShape(ctx, topY0, topY1, (t) => {
    const cup = Math.sin(Math.min(1, t * 1.25) * Math.PI);   // deepest mid-band
    return 0.30 + cup * 0.42;
  }, colour);
  // The strap round the back, level with the middle of the cups.
  torsoShape(ctx, chest.y0 + 78, chest.y0 + 96, () => 1, colour);
  hemShadow(ctx, topY1, 18, 0.72);
  // Halter ties over the shoulders, narrow and close to the neck.
  torsoShape(ctx, BODY.neck.y1 - 18, topY0 + 10, (t) => 0.085 + t * 0.045, colour);

  // The briefs. Cut high at the hip and low at the front, so the waistline
  // rises as it goes round -- the opposite of a rectangle.
  const briefY0 = hips.y0 + 40;
  const briefY1 = hips.y0 + 132;
  torsoShape(ctx, briefY0, briefY1, (t) => {
    const rise = 1 - Math.pow(1 - t, 2);
    return 0.34 + rise * 0.52;
  }, colour);
  torsoShape(ctx, briefY0 + 6, briefY0 + 30, () => 1, colour);
  hemShadow(ctx, briefY1, 16, 0.86);

  // A lighter piping along the hems, which is what stops a solid colour
  // reading as paint on skin.
  ctx.globalAlpha = 0.85;
  torsoShape(ctx, topY1 - 7, topY1, () => 0.72, accent);
  torsoShape(ctx, briefY1 - 7, briefY1, () => 0.86, accent);
  ctx.globalAlpha = 1;
}

function paintFrillSwimsuit(ctx, colour, accent) {
  stripToSkin(ctx);
  const chest = BODY.chest;
  const hips = BODY.hips;

  // A one-piece: continuous from the bust to the hip and all the way round,
  // pinched at the waist.
  const bodyY0 = chest.y0 + 40;
  const bodyY1 = hips.y0 + 118;
  torsoShape(ctx, bodyY0, bodyY1, (t) => {
    const waist = 0.78 - Math.sin(Math.max(0, Math.min(1, (t - 0.28) / 0.42)) * Math.PI) * 0.16;
    return t < 0.16 ? 0.34 + t * 2.9 : waist;
  }, colour);
  torsoShape(ctx, chest.y0 + 80, hips.y0 + 40, () => 1, colour);
  torsoShape(ctx, BODY.neck.y1 - 18, bodyY0 + 10, (t) => 0.10 + t * 0.05, colour);

  // The frill: overlapping scallops round the hip. Drawn as arcs and then
  // covered back down to their hem, so what shows is a gathered edge rather
  // than a row of circles.
  const { front, x0, x1 } = BODY.torso;
  const half = Math.min(front - x0, x1 - front);
  const frillTop = hips.y0 + 26;
  ctx.fillStyle = accent;
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const w = (half * 0.9) / 11;
      ctx.beginPath();
      ctx.ellipse(front + dir * (i + 0.5) * w, frillTop + 44, w * 0.72, 46, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  torsoShape(ctx, bodyY0, frillTop + 10, (t) => {
    const waist = 0.78 - Math.sin(Math.max(0, Math.min(1, (t - 0.4) / 0.6)) * Math.PI) * 0.14;
    return t < 0.22 ? 0.34 + t * 2.1 : waist;
  }, colour);
  hemShadow(ctx, frillTop + 88, 16, 0.9);
}

// Every outfit that hides the outer garments has to paint one of these, and
// the list is checked at load: an outfit that hides Tops and Bottoms without a
// body painter would put her in the texture she happens to be wearing.
const BODY_PAINTERS = {
  bikini: (ctx) => paintBikini(ctx, '#2f5f96', '#f2f4f6'),
  frill: (ctx) => paintFrillSwimsuit(ctx, '#e2718f', '#fdf2f5'),
};

// ---- Outfits ----
//
// `tops` and `bottoms` are recolour specs applied to the model's own garment
// textures; `body` names a painter for the layer underneath. `show` lists which
// of the outer meshes are worn.
export const OUTFITS = [
  {
    key: 'original', label: 'そのまま',
    show: { Tops: true, Bottoms: true },
  },
  {
    key: 'blazer', label: '制服（ブレザー）',
    show: { Tops: true, Bottoms: true },
    tops: { colour: '#2b3350', gamma: 0.86 },
    bottoms: { colour: '#3a4363' },
  },
  {
    key: 'sailor', label: '制服（セーラー）',
    show: { Tops: true, Bottoms: true },
    tops: { colour: '#f3f4f6', gamma: 1.15 },
    bottoms: { colour: '#26304c' },
  },
  {
    key: 'street', label: '街角',
    show: { Tops: true, Bottoms: true },
    tops: { colour: '#c8503f', gamma: 0.95 },
    bottoms: { colour: '#33507a' },
  },
  {
    key: 'date', label: 'デート',
    show: { Tops: true, Bottoms: true },
    tops: { colour: '#f0dfe4', gamma: 1.1 },
    bottoms: { colour: '#8f5f78' },
  },
  {
    key: 'idol', label: 'アイドル',
    show: { Tops: true, Bottoms: true },
    tops: { colour: '#f7f2ff', gamma: 1.15 },
    bottoms: { colour: '#7c4fb8' },
  },
  {
    key: 'bikini', label: '水着（ビキニ）',
    show: { Tops: false, Bottoms: false, Shoes: false },
    body: 'bikini',
  },
  {
    key: 'frill', label: '水着（フリル）',
    show: { Tops: false, Bottoms: false, Shoes: false },
    body: 'frill',
  },
];

export const outfitByKey = (key) => OUTFITS.find((o) => o.key === key) || OUTFITS[0];

// Builds the textures an outfit needs, given the model's own originals.
// Returns canvases keyed by material slot; anything absent is left alone.
export function buildOutfit(outfit, originals) {
  const out = {};
  if (outfit.tops && originals.Tops) {
    const { canvas, ctx } = canvasOf(originals.Tops);
    tintTexture(ctx, outfit.tops.colour, { gamma: outfit.tops.gamma || 1 });
    out.Tops = canvas;
  }
  if (outfit.bottoms && originals.Bottoms) {
    const { canvas, ctx } = canvasOf(originals.Bottoms);
    tintTexture(ctx, outfit.bottoms.colour, { gamma: outfit.bottoms.gamma || 1 });
    out.Bottoms = canvas;
  }
  const painter = outfit.body && BODY_PAINTERS[outfit.body];
  if (painter && originals.Body) {
    const { canvas, ctx } = canvasOf(originals.Body);
    painter(ctx);
    out.Body = canvas;
  }
  return out;
}

// A costume that takes the outer layers off must bring its own. Checked here
// rather than trusted, because the failure mode is not a wrong colour.
export function outfitIsDressed(outfit) {
  const bare = outfit.show && outfit.show.Tops === false && outfit.show.Bottoms === false;
  return !bare || !!(outfit.body && BODY_PAINTERS[outfit.body]);
}
