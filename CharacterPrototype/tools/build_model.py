#!/usr/bin/env python3
"""Rebuild assets/girl.vrm from the upstream VRoid AvatarSample_B.

Why this script exists at all: the model that shipped before was hand-optimised
once and the recipe was never written down, so nobody could tell that the
optimisation had silently dropped every facial morph target until we went
looking for a smile and found the expression list empty. This script is that
recipe, in a form that can be re-run and audited.

What it does, in order:

  1. Recolours her: hair to blue, skin lighter. Done here as a transform of the
     upstream textures rather than by carrying edited images around, so the
     build stays reproducible from the upstream file alone and re-running it
     lands on the same colours instead of shifting them further each time.
  2. Drops the 2MB embedded thumbnail, which nothing renders.
  3. Keeps only the morph targets the VRM expression list actually binds (16 of
     56). This is the step that used to throw away all 56.
  4. Downscales textures, which is where the real size saving is.
  5. Garbage-collects orphaned accessors/bufferViews and rewrites the GLB.

Usage:  python3 tools/build_model.py
"""

import colorsys
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

# Max edge length by texture role. Colour maps carry the readable detail so they
# keep the most; normal/matcap/specular maps are low-frequency and survive a
# harder squeeze without a visible difference at gameplay camera distance.
MAX_EDGE_COLOR = 768
MAX_EDGE_AUX = 512
JPEG_QUALITY = 88

# VRoid's own AvatarSample_B, mirrored in a public samples repo. The models are
# redistributable under VRoid's sample-model terms (see the VRM meta block:
# author "VRoid", redistribution allowed for everyone).
UPSTREAM_URL = (
    "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm"
)

# --- Recolour ---------------------------------------------------------------
# Hair: hue is *set*, not rotated, so the result is the same blue no matter what
# the upstream hair happened to be. Upstream is purple with a teal streak; a
# relative rotation would land those two on different hues and keep the streak
# reading as a separate colour.
HAIR_HUE = 0.60           # ~216 degrees, a clear blue rather than indigo
HAIR_SATURATION = 1.15    # slight lift; the stock hair is muted
HAIR_LIGHTEN = 0.20       # the stock hair is nearly black, which reads as navy
# Which pixels count as hair. Selected by hue, not by saturation: the hair maps
# also carry the cream X clips and the star clips, and those overlap the hair's
# own saturation range completely, so a saturation cutoff either recoloured the
# clips or left the pale lavender fringe highlights behind -- both were tried.
# By hue the two separate cleanly. Measured over the six hair maps: the hair
# occupies 170-353 degrees (teal through purple to magenta, 1.6M pixels) and
# the clips sit at 0-56 degrees, with essentially nothing in between.
HAIR_HUE_MIN = 115 / 255.0
HAIR_HUE_MAX = 250 / 255.0
# Only to skip true greys and whites, where hue is meaningless -- the white
# streak keeps its colour this way.
HAIR_MIN_SATURATION = 8 / 255.0

# The warm pixels the hue mask deliberately skips are the hair clips, which
# upstream are a strong red. The model this replaces carried pale cream clips,
# and swapping them for red is not a change anyone asked for -- so pull most of
# the colour out of them and leave them where they were.
CLIP_DESATURATE = 0.78

# Skin: lift toward white and pull a little of the tan out. The two act on
# independent channels (value and saturation), so the blush and lips keep their
# contrast against the skin rather than washing out with it.
SKIN_LIGHTEN = 0.46       # fraction of the remaining headroom to white
SKIN_DESATURATE = 0.30

# Body_00 is not only skin: the black crop top, the shorts, the socks, the
# choker and the thigh strap are all painted into the same map. Lifting the
# whole image turned the black garments a washed-out olive, so the lift is
# masked to pixels that actually look like skin -- warm hue, not near-black,
# not near-grey. The garments fail one of those three and are left alone.
SKIN_HUE_MAX = 30 / 255.0     # warm side of the wheel (reds through orange)
SKIN_HUE_MIN = 235 / 255.0    # ...wrapping past red the other way
SKIN_MIN_VALUE = 0.35
SKIN_MIN_SATURATION = 0.08

# Images recoloured as skin, by their upstream names. The normal and outline
# maps alongside them carry no colour, so they are deliberately not listed.
SKIN_IMAGES = ('F00_000_00_Face_00', 'F00_000_00_Body_00')

# --- Rings ------------------------------------------------------------------
# Her rings are painted into the body colour map, not modelled, so they cannot
# be removed by dropping geometry the way a hair clip could -- the pixels have
# to be repainted as skin. (Checked the normal map too: it is flat under them,
# so there is no embossing left behind.)
#
# Two things make repainting safe. The search is restricted to triangles the
# rig weights to finger bones, which puts the rest of the metal on this map --
# the choker, the padlock necklace, the studded thigh strap -- out of reach by
# construction rather than by a lucky colour threshold. Then within the fingers,
# metal is picked out by being nearly colourless, which the skin never is.
# Measured that way the rings come out on six proximal phalanges, which is
# where a hand wears them.
RING_IMAGE = 'F00_000_00_Body_00'
RING_MAX_SATURATION = 45     # 0-255; the skin around them sits far above this
RING_MIN_VALUE = 55          # ...and the black nail polish far below it
RING_MAX_VALUE = 240
RING_FEATHER = 3             # px: takes the antialiased edge along with the band
RING_FILL_PASSES = 80        # enough to close the widest band from both sides
# How much of a vertex's skin weight has to sit on finger bones to count as
# finger. Anything lower drags in the knuckles and the back of the hand.
FINGER_WEIGHT = 0.6


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, f"{path} is not a GLB"
    assert version == 2, f"{path} is glTF version {version}, expected 2"
    offset = 12
    js, binary = None, b""
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:      # 'JSON'
            js = json.loads(chunk.decode("utf-8"))
        elif chunk_type == 0x004E4942:    # 'BIN'
            binary = chunk
        offset += 8 + chunk_len + (-chunk_len % 4)
    return js, binary


def write_glb(path, js, binary):
    json_chunk = json.dumps(js, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * (-len(json_chunk) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        f.write(json_chunk)
        f.write(struct.pack("<II", len(binary), 0x004E4942))
        f.write(binary)


def view_bytes(js, binary, view_index):
    view = js["bufferViews"][view_index]
    start = view.get("byteOffset", 0)
    return binary[start: start + view["byteLength"]]


def image_payloads(js, binary):
    """Pull every embedded image out to raw bytes, keyed by image index."""
    out = {}
    for i, img in enumerate(js.get("images", [])):
        if "bufferView" in img:
            out[i] = view_bytes(js, binary, img["bufferView"])
    return out


def hair_material_key(name):
    """'F00_000_Hair_00_HAIR_03' / 'N00_000_Hair_00_HAIR_03 (Instance)' -> 'HAIR_03'."""
    stem = name.split(" (")[0]
    marker = stem.rfind("HAIR_")
    return stem[marker:] if marker >= 0 else None


def _to_hsv(payload):
    """Decode to (float HSV array, alpha channel) so hue/saturation are editable."""
    image = Image.open(io.BytesIO(payload))
    image.load()
    image = image.convert("RGBA")
    red, green, blue, alpha = image.split()
    rgb = Image.merge("RGB", (red, green, blue))
    return np.array(rgb.convert("HSV"), dtype=np.float32), alpha


def _from_hsv(hsv, alpha):
    out = Image.fromarray(np.clip(hsv, 0, 255).astype(np.uint8), "HSV").convert("RGB")
    out.putalpha(alpha)
    buffer = io.BytesIO()
    out.save(buffer, "PNG")   # lossless here; the resize pass picks the final format
    return buffer.getvalue()


def recolour_hair(payload):
    """Set the hair to one hue, leaving the clips and the white streak alone."""
    hsv, alpha = _to_hsv(payload)
    hue, saturation, value = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    is_hair = (
        (hue >= HAIR_HUE_MIN * 255)
        & (hue <= HAIR_HUE_MAX * 255)
        & (saturation >= HAIR_MIN_SATURATION * 255)
    )
    hue[is_hair] = HAIR_HUE * 255
    saturation[is_hair] *= HAIR_SATURATION
    value[is_hair] += (255 - value[is_hair]) * HAIR_LIGHTEN
    saturation[~is_hair] *= 1 - CLIP_DESATURATE
    return _from_hsv(hsv, alpha)


def lighten_skin(payload):
    hsv, alpha = _to_hsv(payload)
    hue, saturation, value = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    warm = (hue <= SKIN_HUE_MAX * 255) | (hue >= SKIN_HUE_MIN * 255)
    skin = warm & (value >= SKIN_MIN_VALUE * 255) & (saturation >= SKIN_MIN_SATURATION * 255)
    saturation[skin] *= 1 - SKIN_DESATURATE
    value[skin] += (255 - value[skin]) * SKIN_LIGHTEN
    return _from_hsv(hsv, alpha)


COMPONENT_TYPES = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
ELEMENT_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_accessor(js, binary, index):
    """One accessor as an (count, components) array, honouring byteStride."""
    acc = js["accessors"][index]
    view = js["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    fmt, size = COMPONENT_TYPES[acc["componentType"]]
    count = ELEMENT_COUNTS[acc["type"]]
    stride = view.get("byteStride") or size * count
    return np.array([
        struct.unpack_from("<" + fmt * count, binary, base + i * stride)
        for i in range(acc["count"])
    ])


def finger_uv_mask(js, binary, size):
    """Boolean mask over the body map of the area finger geometry maps to.

    Built from the rig rather than from coordinates typed in by hand, so it
    stays correct if the mesh is ever rebuilt, and so it can be explained: a
    triangle is finger if all three of its vertices are mostly weighted to
    finger bones.
    """
    from PIL import ImageDraw

    mesh_index = next(
        i for i, mesh in enumerate(js["meshes"]) if "Body" in (mesh.get("name") or "")
    )
    skin_index = next(
        node["skin"] for node in js["nodes"]
        if node.get("mesh") == mesh_index and "skin" in node
    )
    node_names = [node.get("name", "") for node in js["nodes"]]
    joints = js["skins"][skin_index]["joints"]
    finger_joints = {
        slot for slot, joint in enumerate(joints)
        if any(part in node_names[joint]
               for part in ("Thumb", "Index", "Middle", "Ring", "Little"))
    }

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    for prim in js["meshes"][mesh_index]["primitives"]:
        if "JOINTS_0" not in prim["attributes"]:
            continue
        bones = read_accessor(js, binary, prim["attributes"]["JOINTS_0"])
        weights = read_accessor(js, binary, prim["attributes"]["WEIGHTS_0"])
        uv = read_accessor(js, binary, prim["attributes"]["TEXCOORD_0"])
        share = sum(
            np.where(np.isin(bones[:, c], list(finger_joints)), weights[:, c], 0)
            for c in range(bones.shape[1])
        )
        is_finger = share > FINGER_WEIGHT
        triangles = read_accessor(js, binary, prim["indices"])[:, 0].reshape(-1, 3)
        for triangle in triangles[is_finger[triangles].all(axis=1)]:
            draw.polygon(
                [(float(uv[v][0]) * size, float(uv[v][1]) * size) for v in triangle],
                fill=255,
            )
    return np.array(mask) > 0


def _grow(mask, steps):
    for _ in range(steps):
        grown = mask.copy()
        for shift in (1, -1):
            grown |= np.roll(mask, shift, axis=0) | np.roll(mask, shift, axis=1)
        mask = grown
    return mask


def _flood_fill_colour(rgb, holes, source, passes):
    """Grow the surrounding colour inward over `holes`, one ring of pixels a pass.

    A plain average of the whole neighbourhood would be enough for a flat patch;
    growing inward instead follows the gradient the finger already has, so the
    filled band does not read as a flat stripe under raking light.
    """
    out = rgb.astype(np.float32)
    known = source & ~holes
    for _ in range(passes):
        remaining = holes & ~known
        if not remaining.any():
            break
        total = np.zeros_like(out)
        count = np.zeros(holes.shape, dtype=np.float32)
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            total += np.roll(out, shift, axis=axis) * np.roll(known, shift, axis=axis)[..., None]
            count += np.roll(known, shift, axis=axis)
        fillable = remaining & (count > 0)
        if not fillable.any():
            break
        out[fillable] = total[fillable] / count[fillable][..., None]
        known |= fillable
    return out


def remove_rings(payload, finger_mask):
    """Repaint the rings out of the body colour map, as skin."""
    image = Image.open(io.BytesIO(payload))
    image.load()
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    rgb = np.array(image.convert("RGB"))
    hsv = np.array(image.convert("RGB").convert("HSV"), dtype=np.int32)
    hue, saturation, value = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    metal = (
        (saturation < RING_MAX_SATURATION)
        & (value > RING_MIN_VALUE)
        & (value < RING_MAX_VALUE)
    )
    rings = _grow(finger_mask & metal, RING_FEATHER)
    # Fill from skin only. Without this the black nail polish next door is a
    # perfectly good neighbour as far as the fill is concerned, and it bleeds.
    warm = (hue <= SKIN_HUE_MAX * 255) | (hue >= SKIN_HUE_MIN * 255)
    skin = warm & (value >= SKIN_MIN_VALUE * 255) & (saturation >= SKIN_MIN_SATURATION * 255)

    filled = _flood_fill_colour(rgb, rings, skin, RING_FILL_PASSES)
    rgb[rings] = np.clip(filled[rings], 0, 255).astype(np.uint8)

    out = Image.fromarray(rgb, "RGB")
    out.putalpha(alpha)
    buffer = io.BytesIO()
    out.save(buffer, "PNG")
    return buffer.getvalue(), int(rings.sum())


def used_morph_targets(js):
    """Target indices per mesh that the VRM blend-shape groups actually bind."""
    used = {}
    groups = js["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"]
    for group in groups:
        for bind in group.get("binds", []):
            used.setdefault(bind["mesh"], set()).add(bind["index"])
    return used


def strip_morph_targets(js):
    """Drop unbound morph targets and renumber the binds that survive.

    VRM 0.x binds an expression to a morph target by its integer position in
    primitive.targets, so deleting entries means every surviving bind index has
    to move with them -- silently skipping this renumbering would leave the
    expressions pointing at the wrong shapes rather than at nothing, which is
    the more confusing failure.
    """
    used = used_morph_targets(js)
    remap = {}
    for mesh_index, mesh in enumerate(js["meshes"]):
        keep = sorted(used.get(mesh_index, set()))
        if not keep:
            continue
        remap[mesh_index] = {old: new for new, old in enumerate(keep)}
        for prim in mesh["primitives"]:
            if "targets" in prim:
                prim["targets"] = [prim["targets"][i] for i in keep]
        if "weights" in mesh:
            mesh["weights"] = [mesh["weights"][i] for i in keep]

    groups = js["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"]
    for group in groups:
        for bind in group.get("binds", []):
            bind["index"] = remap[bind["mesh"]][bind["index"]]
    return sum(len(v) for v in remap.values())


def drop_thumbnail(js):
    """Remove the VRM meta thumbnail; it is pure payload for a runtime avatar."""
    meta = js["extensions"]["VRM"].get("meta", {})
    if "texture" in meta:
        del meta["texture"]


def is_opaque(image):
    if image.mode not in ("RGBA", "LA", "P"):
        return True
    alpha = image.convert("RGBA").getchannel("A")
    return alpha.getextrema()[0] == 255


def shrink(payload, aux):
    """Resize and re-encode one texture, returning (bytes, mime)."""
    image = Image.open(io.BytesIO(payload))
    image.load()
    limit = MAX_EDGE_AUX if aux else MAX_EDGE_COLOR
    longest = max(image.size)
    if longest > limit:
        scale = limit / longest
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        image = image.resize(size, Image.LANCZOS)

    buffer = io.BytesIO()
    if is_opaque(image):
        image.convert("RGB").save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
        mime = "image/jpeg"
    else:
        image.convert("RGBA").save(buffer, "PNG", optimize=True)
        mime = "image/png"
    encoded = buffer.getvalue()
    # Re-encoding a small texture can come out bigger than it went in; keep
    # whichever is smaller so the "optimisation" never adds weight.
    if len(encoded) >= len(payload) and longest <= limit:
        return payload, None
    return encoded, mime


def aux_image_indices(js):
    """Images used only as normal/matcap/specular maps, which take the harder squeeze."""
    aux = set()
    for mat in js["extensions"]["VRM"].get("materialProperties", []):
        for slot, tex_index in (mat.get("textureProperties") or {}).items():
            if slot in ("_BumpMap", "_SphereAdd", "_EmissionMap", "_RimTexture", "_OutlineWidthTexture"):
                aux.add(js["textures"][tex_index]["source"])
    # A texture that is also somebody's main colour map must not be squeezed.
    for mat in js["extensions"]["VRM"].get("materialProperties", []):
        for slot, tex_index in (mat.get("textureProperties") or {}).items():
            if slot in ("_MainTex", "_ShadeTexture"):
                aux.discard(js["textures"][tex_index]["source"])
    return aux


def collect_referenced_accessors(js):
    used = set()
    for mesh in js.get("meshes", []):
        for prim in mesh["primitives"]:
            used.update(prim.get("attributes", {}).values())
            if "indices" in prim:
                used.add(prim["indices"])
            for target in prim.get("targets", []):
                used.update(target.values())
    for skin in js.get("skins", []):
        if "inverseBindMatrices" in skin:
            used.add(skin["inverseBindMatrices"])
    for anim in js.get("animations", []):
        for sampler in anim.get("samplers", []):
            used.add(sampler["input"])
            used.add(sampler["output"])
    return used


def rebuild(js, binary, new_payloads):
    """Emit a fresh BIN chunk holding only still-referenced data.

    Accessors orphaned by the morph strip are dropped here; everything else is
    copied across and renumbered.
    """
    keep_accessors = sorted(collect_referenced_accessors(js))
    accessor_remap = {old: new for new, old in enumerate(keep_accessors)}

    out = bytearray()
    views = []
    view_remap = {}

    def append_view(payload, stride=None, target=None):
        out.extend(b"\x00" * (-len(out) % 4))
        offset = len(out)
        out.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if stride is not None:
            view["byteStride"] = stride
        if target is not None:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    new_accessors = []
    for old in keep_accessors:
        acc = dict(js["accessors"][old])
        if "bufferView" in acc:
            old_view = acc["bufferView"]
            if old_view not in view_remap:
                source = js["bufferViews"][old_view]
                view_remap[old_view] = append_view(
                    view_bytes(js, binary, old_view),
                    source.get("byteStride"),
                    source.get("target"),
                )
            acc["bufferView"] = view_remap[old_view]
        new_accessors.append(acc)

    new_images = []
    for i, img in enumerate(js.get("images", [])):
        img = dict(img)
        if "bufferView" in img:
            payload, mime = new_payloads.get(i, (view_bytes(js, binary, img["bufferView"]), None))
            img["bufferView"] = append_view(payload)
            if mime:
                img["mimeType"] = mime
        new_images.append(img)

    js["accessors"] = new_accessors
    js["images"] = new_images
    js["bufferViews"] = views
    js["buffers"] = [{"byteLength": len(out)}]

    for mesh in js.get("meshes", []):
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: accessor_remap[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = accessor_remap[prim["indices"]]
            if "targets" in prim:
                prim["targets"] = [
                    {k: accessor_remap[v] for k, v in t.items()} for t in prim["targets"]
                ]
    for skin in js.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = accessor_remap[skin["inverseBindMatrices"]]
    for anim in js.get("animations", []):
        for sampler in anim.get("samplers", []):
            sampler["input"] = accessor_remap[sampler["input"]]
            sampler["output"] = accessor_remap[sampler["output"]]

    return js, bytes(out)


def fetch_source(path):
    """Download the upstream sample model on first run.

    Kept out of git (it is 15MB) but pinned to an exact URL so the build stays
    reproducible without carrying the blob around.
    """
    import urllib.request

    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"downloading {UPSTREAM_URL}")
    urllib.request.urlretrieve(UPSTREAM_URL, path)


def main():
    source = os.path.join(PROJECT, "assets", "source", "AvatarSample_B.vrm")
    target = os.path.join(PROJECT, "assets", "girl.vrm")

    if not os.path.exists(source):
        fetch_source(source)

    js, binary = read_glb(source)
    before = os.path.getsize(source)

    drop_thumbnail(js)
    kept = strip_morph_targets(js)
    print(f"morph targets kept: {kept}")

    # Recolour before the resize pass, so the recoloured maps go through the
    # same sizing policy as everything else. Always driven off the upstream
    # textures, so re-running the build lands on the same colours rather than
    # shifting them further each time.
    payloads = image_payloads(js, binary)
    names = {i: (img.get("name") or "") for i, img in enumerate(js.get("images", []))}

    hair_images = set()
    for mat in js["extensions"]["VRM"].get("materialProperties", []):
        if not hair_material_key(mat.get("name", "")):
            continue
        for slot in ("_MainTex", "_ShadeTexture", "_EmissionMap"):
            tex_index = (mat.get("textureProperties") or {}).get(slot)
            if tex_index is not None:
                hair_images.add(js["textures"][tex_index]["source"])
    for i in hair_images:
        payloads[i] = recolour_hair(payloads[i])
    print(f"hair textures recoloured: {len(hair_images)}")

    # Rings before the skin lift, so the pixels they leave behind are ordinary
    # skin by the time the lift runs and come out the same colour as the finger
    # around them, rather than as a patch at the upstream tone.
    for i, name in names.items():
        if name != RING_IMAGE:
            continue
        size = Image.open(io.BytesIO(payloads[i])).size[0]
        payloads[i], painted = remove_rings(payloads[i], finger_uv_mask(js, binary, size))
        print(f"ring pixels repainted as skin: {painted}")
        # Loudly, rather than quietly shipping the rings back: this whole step
        # is a colour match against an upstream file, and the failure mode if
        # that file ever changes is finding nothing and saying nothing.
        assert painted > 5000, f"ring mask matched almost nothing ({painted}px)"

    skin_images = [i for i, name in names.items() if name in SKIN_IMAGES]
    for i in skin_images:
        payloads[i] = lighten_skin(payloads[i])
    print(f"skin textures lightened: {len(skin_images)}")

    aux = aux_image_indices(js)
    new_payloads = {}
    for i, payload in payloads.items():
        encoded, mime = shrink(payload, aux=i in aux)
        new_payloads[i] = (encoded, mime)

    js, binary = rebuild(js, binary, new_payloads)
    write_glb(target, js, binary)
    after = os.path.getsize(target)
    print(f"{before / 1048576:.2f}MB -> {after / 1048576:.2f}MB  ({target})")


if __name__ == "__main__":
    main()
