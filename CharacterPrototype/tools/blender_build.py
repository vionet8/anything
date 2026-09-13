#!/usr/bin/env python3
"""Headless Blender build of the pink-haired AvatarSample_A recolour.

This is the Blender-side half of a two-way comparison against
tools/build_model.py, which does the same restyle (pink hair, lighter/
desaturated skin) by editing the embedded glTF textures directly with PIL and
never opens Blender at all. This script starts from the *same* upstream file
(assets/source/AvatarSample_A.vrm -- VRoid's own unstyled sample A, licensed
for "Everyone" use) and aims at the same target look, but does every step
inside Blender's own Python (bpy + numpy), driven entirely from the command
line:

    blender --background --python tools/blender_build.py

What it does, in order:

  1. Imports the VRM (it is glTF under the hood; Blender's glTF importer just
     wants a .glb-suffixed path, so the source is copied to one first).
  2. Drops the two non-character helper meshes VRoid embeds for spring-bone
     colliders (a unit cube and a unit icosphere, parented to nothing, with no
     real material) -- they are not part of the visible model.
  3. Recolours the hair (materials named "*_HAIR_NN") to a sakura pink hue and
     lightens + desaturates the skin maps (Face_00, Body_00), by reading each
     image's pixels into a numpy array, converting to HSV with a hand-rolled
     vectorised implementation (no colorsys-per-pixel, no PIL), masking by hue
     the same way build_model.py's lighten_skin() does, and writing the
     pixels back with Image.pixels.foreach_set.
  4. Shade-smooths the character meshes.
  5. Builds a small 3-point studio rig and a seamless cove backdrop (a wide
     slice of a large-radius cylinder, floor curving into a back wall), frames
     a front bust shot and a 3/4 full-body shot, and renders both with Cycles.
  6. Exports the processed scene back out as a plain GLB (no VRM extensions --
     plain glTF export doesn't preserve VRM blendshapes/springbones; that's an
     accepted, disclosed limitation -- this export only has to be good enough
     for a three.js GLTFLoader side-by-side screenshot).

Outputs land in assets/blender/: beauty_bust.png, beauty_full.png,
char-blender.glb.
"""

import math
import os
import shutil

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SOURCE = os.path.join(PROJECT, "assets", "source", "AvatarSample_A.vrm")
OUT_DIR = os.path.join(PROJECT, "assets", "blender")
IMPORT_STAGE = "/tmp/blender_build_AvatarSample_A.glb"

RENDER_ENGINE = os.environ.get("BLENDER_BUILD_ENGINE", "CYCLES")  # or "BLENDER_EEVEE"
RENDER_SAMPLES = int(os.environ.get("BLENDER_BUILD_SAMPLES", "256"))

# --- Recolour targets --------------------------------------------------
# Same magnitude as build_model.py's SKIN_LIGHTEN/SKIN_DESATURATE, and the
# same warm-hue mask (so the black crop top / shorts / choker painted into
# the same Body_00 atlas are left alone). Converted here from build_model's
# PIL-0..255 thresholds to plain 0..360 degrees.
SKIN_LIGHTEN = 0.46
SKIN_DESATURATE = 0.30
SKIN_HUE_MAX_DEG = 30 / 255.0 * 360.0   # ~42.4 deg -- warm red/orange side
SKIN_HUE_MIN_DEG = 235 / 255.0 * 360.0  # ~331.8 deg -- wrapping back past red
SKIN_MIN_VALUE = 0.35
SKIN_MIN_SATURATION = 0.08
SKIN_IMAGES = {"F00_000_00_Face_00", "F00_000_00_Body_00"}

# Hair: sakura/pink, hue set (not rotated) so the result lands in-range no
# matter what upstream hue A's hair happens to be (it ships a warm chestnut
# brown, hue ~355 deg -- already near the target wedge, but set explicitly
# rather than relied upon). 338 deg sits mid-way through the requested
# 330-345 deg window.
HAIR_HUE_TARGET_DEG = 338.0
HAIR_SATURATION_SCALE = 1.35   # moderate lift; stock hair sat is ~0.35-0.40
HAIR_SATURATION_MAX = 0.72     # ceiling so it reads as pink, not neon
HAIR_VALUE_LIFT = 0.16         # fraction of headroom to white
HAIR_MIN_SATURATION = 0.05     # skip near-grey/white (keeps any white streak)
HAIR_MIN_ALPHA = 0.02

CYCLES_DEVICE = os.environ.get("BLENDER_BUILD_DEVICE", "CPU")


def log(*a):
    print("[blender_build]", *a, flush=True)


# --- HSV: own vectorised implementation (colorsys's convention: h,s,v in
# [0,1]), operated on numpy arrays instead of PIL --------------------------

def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maxc = np.max(rgb, axis=-1)
    minc = np.min(rgb, axis=-1)
    v = maxc
    delta = maxc - minc
    safe_delta = np.where(delta == 0, 1, delta)
    s = np.where(maxc == 0, 0, delta / np.where(maxc == 0, 1, maxc))
    rc = (maxc - r) / safe_delta
    gc = (maxc - g) / safe_delta
    bc = (maxc - b) / safe_delta
    h = np.zeros_like(maxc)
    h = np.where(maxc == r, bc - gc, h)
    h = np.where(maxc == g, 2.0 + rc - bc, h)
    h = np.where(maxc == b, 4.0 + gc - rc, h)
    h = (h / 6.0) % 1.0
    h = np.where(delta == 0, 0.0, h)
    return h, s, v


def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - f * s)
    t = v * (1.0 - (1.0 - f) * s)
    i = (i.astype(np.int64)) % 6
    conditions = [i == 0, i == 1, i == 2, i == 3, i == 4, i == 5]
    r = np.select(conditions, [v, q, p, p, t, v], default=v)
    g = np.select(conditions, [t, v, v, q, p, p], default=v)
    b = np.select(conditions, [p, p, t, v, v, q], default=v)
    return r, g, b


# --- Image pixel IO (foreach_get/set -- far faster than image.pixels[:]) --

def load_pixels(img):
    w, h = img.size
    flat = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(flat)
    return flat.reshape(h, w, 4)


def store_pixels(img, arr):
    img.pixels.foreach_set(np.clip(arr, 0.0, 1.0).reshape(-1).astype(np.float32))
    img.pack()
    img.update()


# --- Recolour passes -----------------------------------------------------

def recolour_hair_image(img):
    arr = load_pixels(img)
    rgb, alpha = arr[..., :3], arr[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    mask = (alpha > HAIR_MIN_ALPHA) & (s > HAIR_MIN_SATURATION)
    h2 = np.where(mask, HAIR_HUE_TARGET_DEG / 360.0, h)
    s2 = np.where(mask, np.minimum(s * HAIR_SATURATION_SCALE, HAIR_SATURATION_MAX), s)
    v2 = np.where(mask, v + (1.0 - v) * HAIR_VALUE_LIFT, v)
    r, g, b = hsv_to_rgb(h2, s2, v2)
    store_pixels(img, np.stack([r, g, b, alpha], axis=-1))
    return int(mask.sum())


def recolour_skin_image(img):
    arr = load_pixels(img)
    rgb, alpha = arr[..., :3], arr[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    deg = h * 360.0
    warm = (deg <= SKIN_HUE_MAX_DEG) | (deg >= SKIN_HUE_MIN_DEG)
    mask = warm & (v >= SKIN_MIN_VALUE) & (s >= SKIN_MIN_SATURATION) & (alpha > 0.02)
    s2 = np.where(mask, s * (1.0 - SKIN_DESATURATE), s)
    v2 = np.where(mask, v + (1.0 - v) * SKIN_LIGHTEN, v)
    r, g, b = hsv_to_rgb(h, s2, v2)
    store_pixels(img, np.stack([r, g, b, alpha], axis=-1))
    return int(mask.sum())


# --- Import & cleanup ------------------------------------------------------

def import_vrm():
    if os.path.exists(IMPORT_STAGE):
        os.remove(IMPORT_STAGE)
    shutil.copyfile(SOURCE, IMPORT_STAGE)
    bpy.ops.import_scene.gltf(filepath=IMPORT_STAGE)
    os.remove(IMPORT_STAGE)


def drop_collider_helpers():
    """VRoid embeds a unit cube + unit icosphere for spring-bone colliders;
    they are unparented, untextured, and not part of the visible character."""
    for name in ("Cube", "Icosphere"):
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh and mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def get_base_color_image(mat):
    """The image behind a material's colour, however the importer wired it.

    Discovered empirically: these VRM materials come in over glTF's
    KHR_materials_unlit (MToon has no standard PBR equivalent), so Blender's
    importer gives every one of them an Emission-shader graph, not a
    Principled BSDF -- there is no "Base Color" socket to read at all until
    convert_to_principled() below rebuilds it. So: try Principled first (in
    case a future Blender version imports these differently), fall back to
    Emission's Color input, and fall back again to "the material's only
    Image Texture node" for anything stranger than either.
    """
    if not mat.use_nodes or mat.node_tree is None:
        return None
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            inp = node.inputs.get("Base Color")
            if inp and inp.is_linked:
                src = inp.links[0].from_node
                if src.type == "TEX_IMAGE" and src.image:
                    return src.image
    for node in mat.node_tree.nodes:
        if node.type == "EMISSION":
            inp = node.inputs.get("Color")
            if inp and inp.is_linked:
                src = inp.links[0].from_node
                if src.type == "TEX_IMAGE" and src.image:
                    return src.image
    tex_nodes = [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    if len(tex_nodes) == 1:
        return tex_nodes[0].image
    return None


# Roughness/specular by rough material category -- crude but far better than
# one flat value across skin, hair, cloth and eyes.
SHADING_BY_KEYWORD = [
    ("EyeWhite", (0.25, 0.4)),
    ("EyeIris", (0.10, 0.6)),
    ("EyeHighlight", (0.05, 0.6)),
    ("EyeExtra", (0.10, 0.5)),
    ("HAIR", (0.40, 0.45)),
    ("SKIN", (0.50, 0.35)),
    ("CLOTH", (0.78, 0.3)),
    ("FACE", (0.45, 0.35)),
]
DEFAULT_SHADING = (0.55, 0.4)


def shading_for(material_name):
    for key, values in SHADING_BY_KEYWORD:
        if key in material_name:
            return values
    return DEFAULT_SHADING


def convert_to_principled(mat):
    """Rebuild the imported unlit Emission graph as a proper lit Principled
    BSDF, keeping the same Image Texture node (and whatever UV node feeds
    its Vector input) so the recoloured pixels and UV mapping carry over
    untouched -- only the shading model changes."""
    if not mat.use_nodes or mat.node_tree is None:
        return False
    nt = mat.node_tree
    tex_node = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image), None)
    output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if tex_node is None or output is None:
        return False

    keep = {tex_node, output}
    vec_in = tex_node.inputs.get("Vector")
    if vec_in and vec_in.is_linked:
        keep.add(vec_in.links[0].from_node)
    for node in list(nt.nodes):
        if node not in keep:
            nt.nodes.remove(node)

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (tex_node.location.x + 300, tex_node.location.y)
    nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])

    roughness, specular = shading_for(mat.name)
    bsdf.inputs["Roughness"].default_value = roughness
    spec_input = bsdf.inputs.get("Specular") or bsdf.inputs.get("Specular IOR Level")
    if spec_input:
        spec_input.default_value = specular

    if mat.blend_method != "OPAQUE":
        alpha_out = tex_node.outputs.get("Alpha")
        if alpha_out:
            nt.links.new(alpha_out, bsdf.inputs["Alpha"])

    nt.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return True


def convert_all_materials():
    converted = 0
    for mat in bpy.data.materials:
        if convert_to_principled(mat):
            converted += 1
    log(f"materials rebuilt as Principled BSDF: {converted} / {len(bpy.data.materials)}")


def recolour_all():
    hair_mats = [m for m in bpy.data.materials if "HAIR_" in m.name]
    hair_images = {}
    for mat in hair_mats:
        img = get_base_color_image(mat)
        if img:
            hair_images[img.name] = img
    total_hair_px = 0
    for img in hair_images.values():
        total_hair_px += recolour_hair_image(img)
    log(f"hair materials: {len(hair_mats)}, hair images recoloured: {len(hair_images)}, "
        f"pixels touched: {total_hair_px}")

    total_skin_px = 0
    skin_count = 0
    for name in SKIN_IMAGES:
        img = bpy.data.images.get(name)
        if img is None:
            log(f"WARNING: expected skin image {name!r} not found")
            continue
        total_skin_px += recolour_skin_image(img)
        skin_count += 1
    log(f"skin images lightened: {skin_count}, pixels touched: {total_skin_px}")


def shade_smooth_all():
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        for poly in mesh.polygons:
            poly.use_smooth = True
        try:
            mesh.use_auto_smooth = True
            mesh.auto_smooth_angle = math.radians(60)
        except AttributeError:
            pass  # Blender >=4.1 dropped this in favour of a geometry-nodes modifier


# --- Pose -----------------------------------------------------------------
# VRM ships in a T-pose, which reads as a mannequin in a beauty shot. Rotate
# both upper arms down to a relaxed at-the-sides pose (measured empirically:
# -78deg around local Z on the right upper arm, mirrored, lands the hands
# just outside the hips without the elbow clipping into the torso).

ARM_DROP_DEG = 78.0


def pose_relaxed_arms():
    arm = bpy.data.objects.get("Armature")
    if arm is None:
        return
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for name, sign in (("J_Bip_R_UpperArm", -1), ("J_Bip_L_UpperArm", 1)):
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.0, 0.0, math.radians(sign * ARM_DROP_DEG))
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


# --- Scene bounds -----------------------------------------------------

CHARACTER_MESH_NAMES = {"Body", "Face", "Hair001"}


def character_bounds():
    """Bounds of the *posed* character. Object.bound_box reflects the rest
    mesh, not the armature deformation, so this reads the depsgraph-evaluated
    (i.e. actually posed) vertices instead -- otherwise the relaxed-arms pose
    above would still frame the camera for a T-pose's shoulder-to-shoulder
    span."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name not in CHARACTER_MESH_NAMES:
            continue
        eval_obj = obj.evaluated_get(depsgraph)
        mesh = eval_obj.to_mesh()
        coords = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", coords)
        coords = coords.reshape(-1, 3)
        world = np.array(eval_obj.matrix_world)
        world_coords = coords @ world[:3, :3].T + world[:3, 3]
        lo, hi = world_coords.min(axis=0), world_coords.max(axis=0)
        mn.x, mn.y, mn.z = min(mn.x, lo[0]), min(mn.y, lo[1]), min(mn.z, lo[2])
        mx.x, mx.y, mx.z = max(mx.x, hi[0]), max(mx.y, hi[1]), max(mx.z, hi[2])
        eval_obj.to_mesh_clear()
    return mn, mx


# --- Backdrop, lights, camera --------------------------------------------
# Orientation note: the glTF/VRM importer's Y-up -> Z-up conversion leaves
# this character facing +Y in Blender world space (checked against the
# Face mesh: its bounding box bulges toward +Y, where the nose is). So the
# camera that sees her from the front sits on the +Y side of her, looking
# back in the -Y direction; the backdrop goes behind her, on the -Y side.

def build_cove_backdrop(mn, mx, width_pad=7.0, radius=1.1, wall_height=4.5,
                         floor_run=2.2):
    """A wide slice of a large-radius cylinder: flat floor curving smoothly
    into a vertical back wall, the classic seamless-paper photo cove -- built
    directly with bmesh so there is no modifier-axis guesswork."""
    half_w = (mx.x - mn.x) / 2 + width_pad
    wall_y = mn.y - floor_run - radius  # where the wall's flat run begins

    verts_local = []
    # Flat floor, from just in front of the character back to the fillet.
    n_floor = 8
    for i in range(n_floor):
        t = i / (n_floor - 1)
        y = (mx.y + 1.4) * (1 - t) + (wall_y + radius) * t
        verts_local.append((y, 0.0))
    # Quarter-circle fillet from floor (tangent horizontal) to wall (tangent
    # vertical), centred directly above the floor/wall corner.
    n_arc = 14
    center_y, center_z = wall_y, radius
    for i in range(1, n_arc + 1):
        a = (i / n_arc) * (math.pi / 2)
        y = center_y + radius * math.cos(a)
        z = center_z - radius * math.sin(a)
        verts_local.append((y, z))
    # Flat wall, up past the character's head.
    n_wall = 6
    for i in range(1, n_wall + 1):
        t = i / n_wall
        z = radius + t * (wall_height - radius)
        verts_local.append((wall_y, z))

    mesh = bpy.data.meshes.new("Backdrop")
    bm = bmesh.new()
    rows = []
    for x in (-half_w, half_w):
        row = [bm.verts.new((x, y, z)) for (y, z) in verts_local]
        rows.append(row)
    for i in range(len(verts_local) - 1):
        bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Backdrop", mesh)
    bpy.context.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True

    mat = bpy.data.materials.new("BackdropMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.6, 0.61, 0.64, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    obj.data.materials.append(mat)
    return obj


def add_area_light(name, location, target, energy, size, color=(1.0, 1.0, 1.0)):
    light_data = bpy.data.lights.new(name, type="AREA")
    light_data.energy = energy
    light_data.size = size
    light_data.color = color
    obj = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def build_lighting(mn, mx):
    center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z + (mx.z - mn.z) * 0.55))
    span = max(mx.x - mn.x, mx.z - mn.z)

    # Key: warm-neutral, camera side (+Y), raised and off to one side.
    add_area_light(
        "KeyLight",
        location=(center.x + span * 1.3, mx.y + span * 2.1, mx.z + span * 0.9),
        target=center,
        energy=55,
        size=1.3,
        color=(1.0, 0.97, 0.92),
    )
    # Fill: cool-neutral, softer, opposite side, lower, also camera-side.
    add_area_light(
        "FillLight",
        location=(center.x - span * 1.7, mx.y + span * 1.6, center.z + span * 0.1),
        target=center,
        energy=18,
        size=2.4,
        color=(0.93, 0.96, 1.0),
    )
    # Rim/back: on the backdrop side, above and behind, to separate the hair
    # and shoulders from the backdrop.
    add_area_light(
        "RimLight",
        location=(center.x - span * 0.4, mn.y - span * 1.6, mx.z + span * 1.2),
        target=(center.x, mn.y, mx.z * 0.9),
        energy=32,
        size=1.0,
        color=(1.0, 0.95, 0.98),
    )
    # Soft broad light on the backdrop itself so it reads as a clean seamless
    # sweep rather than falling into shadow.
    add_area_light(
        "BackdropLight",
        location=(center.x, mx.y + span * 1.0, center.z + span * 1.6),
        target=(center.x, mn.y - span, center.z),
        energy=24,
        size=3.2,
        color=(1.0, 1.0, 1.0),
    )

    # Matches the backdrop's own tone (not pure black) so that if the cove
    # doesn't quite fill frame at a grazing camera angle, the gap reads as
    # more backdrop rather than a hole into space.
    world = bpy.context.scene.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.55, 0.56, 0.59, 1.0)
        bg.inputs[1].default_value = 0.6


SENSOR_HEIGHT = 24.0  # mm, full-frame-ish; paired with sensor_fit='VERTICAL'
                       # so the vertical FOV only depends on lens, not on
                       # whatever aspect ratio each shot renders at.


def vertical_fit_distance(lens, vertical_extent, target_frac):
    """Distance along the view axis so `vertical_extent` fills `target_frac`
    of the frame's height, for a camera with sensor_fit='VERTICAL'."""
    fov = 2 * math.atan(SENSOR_HEIGHT / (2 * lens))
    return vertical_extent / (2 * target_frac * math.tan(fov / 2))


def setup_camera(name, location, target, lens=85):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = SENSOR_HEIGHT
    cam_obj = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = location
    direction = Vector(target) - Vector(location)
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam_obj
    return cam_obj


def render_to(path, width, height):
    scene = bpy.context.scene
    scene.render.filepath = path
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    log(f"rendered {path}")


def configure_render_engine():
    scene = bpy.context.scene
    scene.render.engine = RENDER_ENGINE
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 0.0
    if RENDER_ENGINE == "CYCLES":
        cyc = scene.cycles
        cyc.samples = RENDER_SAMPLES
        # This apt-packaged Blender build has no OpenImageDenoise support
        # compiled in ("Build without OpenImageDenoiser" is a hard render
        # error, not a warning) -- compensate with more samples instead.
        cyc.use_denoising = False
        cyc.use_adaptive_sampling = True
        cyc.adaptive_threshold = 0.01
        cyc.device = CYCLES_DEVICE
    else:
        scene.eevee.taa_render_samples = 64
        scene.eevee.use_soft_shadows = True


def export_glb():
    """Character only -- the backdrop/lights/cameras built for the beauty
    renders are a photo-studio rig, not part of the model."""
    out = os.path.join(OUT_DIR, "char-blender.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" or (obj.type == "MESH" and obj.name in CHARACTER_MESH_NAMES):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_morph=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    log(f"exported {out} ({os.path.getsize(out)/1048576:.2f} MB)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    import_vrm()
    drop_collider_helpers()
    recolour_all()
    convert_all_materials()
    shade_smooth_all()
    pose_relaxed_arms()

    mn, mx = character_bounds()
    log("character bounds:", tuple(mn), tuple(mx))

    build_cove_backdrop(mn, mx)
    build_lighting(mn, mx)
    configure_render_engine()

    height = mx.z - mn.z
    y_mid = (mn.y + mx.y) / 2

    # Front bust shot: hair-top down to mid-torso, straight-on.
    bust_lens = 100
    bust_top = mx.z + height * 0.04
    bust_bottom = mn.z + height * 0.66
    bust_extent = bust_top - bust_bottom
    bust_dist = vertical_fit_distance(bust_lens, bust_extent, target_frac=0.97)
    bust_mid_z = (bust_top + bust_bottom) / 2
    bust_target = (0, y_mid, bust_mid_z)
    setup_camera("BustCam", (0.0, mx.y + bust_dist, bust_mid_z), bust_target, lens=bust_lens)
    render_to(os.path.join(OUT_DIR, "beauty_bust.png"), 1024, 1280)

    # Full-body 3/4 shot: head-to-floor with margin, camera swung 35deg
    # around the character so both the front and one side read.
    full_lens = 50
    full_top = mx.z + height * 0.07
    full_bottom = mn.z - height * 0.025
    full_extent = full_top - full_bottom
    full_dist = vertical_fit_distance(full_lens, full_extent, target_frac=0.88)
    full_mid_z = (full_top + full_bottom) / 2
    full_target_z = mn.z + height * 0.52
    yaw = math.radians(35)
    full_cam = (full_dist * math.sin(yaw), y_mid + full_dist * math.cos(yaw), full_mid_z)
    setup_camera("FullCam", full_cam, (0, y_mid, full_target_z), lens=full_lens)
    render_to(os.path.join(OUT_DIR, "beauty_full.png"), 1080, 1440)

    export_glb()
    log("done")


if __name__ == "__main__":
    main()
