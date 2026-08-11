#!/usr/bin/env python3
"""Rebuild assets/girl.vrm from the upstream VRoid AvatarSample_B.

Why this script exists at all: the model that shipped before was hand-optimised
once and the recipe was never written down, so nobody could tell that the
optimisation had silently dropped every facial morph target until we went
looking for a smile and found the expression list empty. This script is that
recipe, in a form that can be re-run and audited.

What it does, in order:

  1. Ports the recoloured hair textures across from the previous model. The two
     files come from different VRoid Studio versions (F00_* vs N00_* asset
     names, 2054 vs 4709 face vertices), so geometry cannot be shared -- but
     the hair materials correspond one-to-one by name suffix (HAIR_01..HAIR_06)
     and share a UV layout, so the textures transfer exactly. That is the whole
     of the "recolour" that the previous model carried: the outfit is stock.
  2. Drops the 2MB embedded thumbnail, which nothing renders.
  3. Keeps only the morph targets the VRM expression list actually binds (16 of
     56). This is the step that used to throw away all 56.
  4. Downscales textures, which is where the real size saving is.
  5. Garbage-collects orphaned accessors/bufferViews and rewrites the GLB.

Usage:  python3 tools/build_model.py
"""

import io
import json
import os
import struct
import sys

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


def current_hair_textures(path):
    """Map HAIR_0n -> encoded base-colour image bytes from the previous model."""
    js, binary = read_glb(path)
    payloads = image_payloads(js, binary)
    out = {}
    for mat in js.get("materials", []):
        key = hair_material_key(mat.get("name", ""))
        if not key:
            continue
        tex = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if not tex:
            continue
        source = js["textures"][tex["index"]]["source"]
        if source in payloads:
            out[key] = payloads[source]
    return out


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

    # Read the hair colours out of whatever girl.vrm is there now, before it
    # gets overwritten. Re-running against an already-built model is a no-op
    # for colour, since the output carries the ported textures too.
    hair = current_hair_textures(target) if os.path.exists(target) else {}
    print(f"recoloured hair textures found: {len(hair)}")

    js, binary = read_glb(source)
    before = os.path.getsize(source)

    drop_thumbnail(js)
    kept = strip_morph_targets(js)
    print(f"morph targets kept: {kept}")

    # Swap the hair colour maps over before the resize pass, so the ported
    # textures get sized by the same policy as everything else.
    payloads = image_payloads(js, binary)
    for mat in js["extensions"]["VRM"].get("materialProperties", []):
        key = hair_material_key(mat.get("name", ""))
        if not key or key not in hair:
            continue
        for slot in ("_MainTex", "_ShadeTexture"):
            tex_index = (mat.get("textureProperties") or {}).get(slot)
            if tex_index is not None:
                payloads[js["textures"][tex_index]["source"]] = hair[key]

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
