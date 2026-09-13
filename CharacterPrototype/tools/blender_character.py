#!/usr/bin/env python3
"""Builds the "summer engawa" original character: char-e (AvatarSample_A with
silver hair/crimson eyes/lightened skin, already built by tools/build_model.py)
re-hairstyled with AvatarSample_B's long twintails in silver, given procedural
animal ears, and re-coloured into a warm-gold/pale-blue summer palette.

Importable interface (what the composition step should use):

    import blender_character as bc
    root, armature = bc.build_character()

build_character() builds into the *current* bpy scene and returns the
character's root Empty and its Armature object. It does not touch render
engine, world, lights or camera, and does not pose or move the armature
beyond parenting it under the root -- the composition step supplies the
studio/scene and does the posing.

Standing alone (`blender --background --python tools/blender_character.py`)
runs build_character() and then, only for this script's own test renders,
poses the arms down and builds a throwaway studio rig (backdrop/lights/
camera, reusing blender_build's helpers) to render:

    assets/blender/char_summer_bust.png
    assets/blender/char_summer_full.png

Geometry conventions (for whoever poses her next):
  - Z-up, metres. Feet are at Z=0 in the returned rest state.
  - Skeleton is VRM's standard biped naming: J_Bip_{L,R}_UpperArm/LowerArm/
    Hand/..., J_Bip_C_Head/Neck/Spine/Hips, J_Bip_{L,R}_UpperLeg/LowerLeg/
    Foot. J_Sec_* are physics/jiggle bones (bust, hood string); the grafted
    hair's own spring-bone chain was discarded (see graft_silver_hair()) so
    there are no HairJoint-* bones left for it, but the two ears ARE real
    skinned geometry, 100% weighted to J_Bip_C_Head -- rotate that bone and
    they follow like any other attached part.
  - T-pose is the bind/rest pose, as imported. To bring an arm down to a
    relaxed at-the-sides stance (this file's own test renders do exactly
    this -- see pose_test_arms() below): in POSE mode, set rotation_mode
    to 'XYZ' on J_Bip_R_UpperArm / J_Bip_L_UpperArm and rotate LOCAL Z by
    -78deg / +78deg respectively (signs are mirrored between the two
    sides). That was measured empirically (not guessed) by rotating each
    axis in turn and watching where the hand bone's world position moved.
"""

import colorsys
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blender_build as bb   # noqa: E402  (HSV/material/render helpers)
import blender_wig as bw     # noqa: E402  (glb-import + hair-graft helpers)

PROJECT = bb.PROJECT
SOURCE_E = os.path.join(PROJECT, "assets", "char-e.vrm")
SOURCE_B = bw.SOURCE_B
STAGE_E = "/tmp/blender_character_E.glb"
STAGE_B = "/tmp/blender_character_B.glb"
OUT_DIR = bb.OUT_DIR

CHARACTER_MESH_NAMES = {"Body", "Face", "Hair001", "EarL", "EarR"}


def log(*a):
    print("[blender_character]", *a, flush=True)


# --- Silver hair recolour ---------------------------------------------
# build_model.py's own char-e silver recipe, reused verbatim rather than
# re-derived: hue *set* to 0.58 (~209deg, cool) rather than desaturated in
# place, because a neutral desaturation of a coloured hair lands on a dun
# grey that reads as dirty blonde -- the cool hue is what makes it read as
# platinum. Saturation cut to 12%, value lifted 62% of the way to white.
# Masked the same way build_model.py measured AvatarSample_B's own hair maps:
# hue 115-250 (of 255) is the hair; 0-56 is the clips, left alone (the
# ribbons/star clips read fine un-silvered -- see the module docstring).
SILVER_HAIR_HUE = 0.58
SILVER_SAT_SCALE = 0.12
SILVER_VALUE_LIFT = 0.62
B_HAIR_HUE_MIN = 115 / 255.0
B_HAIR_HUE_MAX = 250 / 255.0
B_HAIR_MIN_SATURATION = 8 / 255.0


GREY_LIFT_MIN_VALUE = 0.10   # leave true black (outline strokes) alone
GREY_LIFT_MAX_VALUE = 0.80   # ...and anything already pale, e.g. the star clips


def recolour_hair_silver(img):
    """Hue band -> platinum, plus a second pass over the greys.

    The hue mask alone leaves B's large near-colourless under-panels dark,
    because a saturation floor is what stops a hue rotation from acting on
    pixels whose hue is meaningless. Against pink that read as a deliberate
    two-tone; against silver it just read as dirty grey streaks. So the mid
    greys get the same value lift with their (meaningless) hue left alone --
    bounded below so the black outline strokes keep their definition, and
    above so the cream star clips aren't blown out.
    """
    arr = bb.load_pixels(img)
    rgb, alpha = arr[..., :3], arr[..., 3]
    h, s, v = bb.rgb_to_hsv(rgb)
    mask = (h >= B_HAIR_HUE_MIN) & (h <= B_HAIR_HUE_MAX) & (s >= B_HAIR_MIN_SATURATION)
    grey = ((s < B_HAIR_MIN_SATURATION) & (v >= GREY_LIFT_MIN_VALUE)
            & (v <= GREY_LIFT_MAX_VALUE) & (alpha > 0.02))

    h2 = np.where(mask, SILVER_HAIR_HUE, h)
    s2 = np.where(mask, s * SILVER_SAT_SCALE, s)
    lifted = v + (1.0 - v) * SILVER_VALUE_LIFT
    v2 = np.where(mask | grey, lifted, v)
    # give the lifted greys the same cool cast the hair has, so they sit in
    # the same family rather than reading as a neutral wash
    h2 = np.where(grey, SILVER_HAIR_HUE, h2)
    s2 = np.where(grey, 0.05, s2)

    r, g, b = bb.hsv_to_rgb(h2, s2, v2)
    bb.store_pixels(img, np.stack([r, g, b, alpha], axis=-1))
    return int(mask.sum()), int(grey.sum())


def drop_collider_helpers_scoped(imported_names):
    """VRoid embeds a unit cube + unit icosphere as spring-bone collider
    proxies. blender_build.drop_collider_helpers() finds them by global
    name, which is fine for a script that owns the whole scene but not for
    a module imported into someone else's -- a scene with its own object
    called "Cube" would lose it. Only ever touch objects this import made."""
    dropped = []
    for name in imported_names:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            continue
        stem = name.split(".")[0]
        if stem not in ("Cube", "Icosphere"):
            continue
        if obj.parent is not None or obj.vertex_groups:
            continue  # a real, rigged part of somebody's character
        bw.remove_object(obj)
        dropped.append(name)
    return dropped


def graft_silver_hair():
    """Same technique as blender_wig.graft_hair() (delete char-e's own hair,
    bring in B's, bake its Armature modifier at bind pose and detach it,
    align to the head by measured translation+scale) but recoloured silver
    instead of pink, and starting from char-e rather than raw AvatarSample_A.
    B's hair is skinned to its own spring-bone chain, same finding as last
    time -- baking at bind pose and rigidly placing it renders identically
    to porting that chain, for a still frame, at much lower risk.
    """
    e_objects = bw.import_glb(SOURCE_E, STAGE_E)
    drop_collider_helpers_scoped(e_objects)

    e_armature = bpy.data.objects["Armature"]
    e_face = bpy.data.objects["Face"]
    e_hair = bw.find_hair_mesh(e_objects)
    assert e_hair is not None, "couldn't find char-e's hair mesh"
    e_head_world = bw.head_bone_world(e_armature)
    e_face_min, e_face_max = bw.world_bbox(e_face)
    e_face_height = e_face_max.z - e_face_min.z
    log(f"char-e hair: {e_hair.name} ({len(e_hair.data.vertices)} verts), "
        f"head bone world={tuple(e_head_world)}, face height={e_face_height:.4f}")
    bw.remove_object(e_hair)

    b_objects = bw.import_glb(SOURCE_B, STAGE_B)
    drop_collider_helpers_scoped(b_objects)

    b_live = bw.live_objects(b_objects)
    b_armature = next(o for o in b_live if o.type == "ARMATURE")
    b_face = next(o for o in b_live if o.name.startswith("Face"))
    b_hair = bw.find_hair_mesh(b_objects)
    assert b_hair is not None, "couldn't find B's hair mesh"
    b_head_world = bw.head_bone_world(b_armature)
    b_face_min, b_face_max = bw.world_bbox(b_face)
    b_face_height = b_face_max.z - b_face_min.z

    bpy.context.view_layer.objects.active = b_hair
    bpy.ops.object.select_all(action="DESELECT")
    b_hair.select_set(True)
    arm_mod = next((m for m in b_hair.modifiers if m.type == "ARMATURE"), None)
    if arm_mod:
        bpy.ops.object.modifier_apply(modifier=arm_mod.name)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")

    scale = e_face_height / b_face_height
    log(f"fit: translate by {tuple(e_head_world - b_head_world)}, uniform scale {scale:.4f}")
    correction = (
        Matrix.Translation(e_head_world)
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
        @ Matrix.Translation(-b_head_world)
    )
    b_hair.matrix_world = correction @ b_hair.matrix_world

    for obj in bw.live_objects(b_objects):
        if obj is b_hair:
            continue
        bw.remove_object(obj)

    aligned_world = b_hair.matrix_world.copy()
    b_hair.name = "Hair001"
    b_hair.parent = e_armature
    b_hair.matrix_parent_inverse = e_armature.matrix_world.inverted()
    b_hair.matrix_world = aligned_world

    hair_mats = [s.material for s in b_hair.material_slots
                 if s.material and "HAIR_" in s.material.name]
    images_done = set()
    total_px = 0
    grey_total = 0
    for mat in hair_mats:
        img = bb.get_base_color_image(mat)
        if img and img.name not in images_done:
            hair_px, grey_px = recolour_hair_silver(img)
            total_px += hair_px
            grey_total += grey_px
            images_done.add(img.name)
    log(f"grafted hair materials: {len(hair_mats)}, images silvered: {len(images_done)}, "
        f"hue-band px: {total_px}, grey-lift px: {grey_total}")

    return e_armature, b_hair


# --- Animal ears --------------------------------------------------------
# Built as a thin, tapered, cupped shell (an inner concave surface + an
# outer convex surface offset by a small thickness, stitched shut along both
# side rims) rather than a flattened cone -- a flat cone reads as a party
# hat. Skinned 100% to J_Bip_C_Head via a vertex group + Armature modifier,
# the same mechanism every other part of this rig uses to attach to a bone,
# so they follow head rotation like hair or a hair clip would.

EAR_LENGTH = 0.125
EAR_BASE_WIDTH = 0.078
EAR_THICKNESS = 0.008
# Cup depth is deliberately much smaller than the ear's half-width. At 24mm
# against a ~30mm half-width the dish became a slot: from the front you saw
# its near-vertical fur walls and the pink only peeked out at the tip, where
# the cup tapers. 10mm reads as cupped and still shows its inside.
EAR_CUP_DEPTH = 0.010
EAR_BACK_BULGE = 0.55      # outer surface's rounding, as a fraction of the cup
EAR_OUTWARD = 0.50         # tip's sideways lean, as a fraction of the length
EAR_TIP_WIDTH = 0.004      # a hair of bluntness; a true point reads as a spear
EAR_LEN_SEGMENTS = 14
EAR_WIDTH_SEGMENTS = 9
EAR_INNER_U = 0.78         # |u| inside which the inner dish is pink; outside
EAR_INNER_T = (0.06, 0.90)  # it stays fur, which is what makes the rim read


def _ear_profile(t):
    """(outward, forward, up, width, cup) at t in [0,1] (0=base, 1=tip).

    Width peaks around a third of the way up rather than at the base, which
    is what separates an ear silhouette from a cone."""
    leaf = (1.0 - t) ** 0.6 * (0.45 + 0.55 * math.sin(math.pi * min(1.0, t / 0.35) / 2.0 + 0.35))
    width = max(EAR_BASE_WIDTH * leaf, EAR_TIP_WIDTH)
    outward = (t ** 0.85) * EAR_LENGTH * EAR_OUTWARD
    forward = -0.010 + math.sin(t * math.pi * 0.55) * EAR_LENGTH * 0.16
    up = math.sin(t * math.pi * 0.5) * EAR_LENGTH
    cup = EAR_CUP_DEPTH * (1.0 - 0.55 * t)
    return outward, forward, up, width, cup


def build_ear(name, side, base_pos, fur_mat, inner_mat):
    """side: +1 for the character's right ear, -1 for her left.

    Three surfaces, not two: the rim sits at the ear's front plane, the
    inner dish *recedes behind it* (an earlier version pushed the middle
    forward instead, which made a convex cone -- it rendered as a pink horn),
    and the outer surface bulges gently away behind that. The pink inner
    material is inset within the dish so a fur rim frames it all the way
    round.
    """
    inner_rows, outer_rows, u_rows = [], [], []
    for i in range(EAR_LEN_SEGMENTS):
        t = i / (EAR_LEN_SEGMENTS - 1)
        outward, forward, up, width, cup = _ear_profile(t)
        center = base_pos + Vector((side * outward, forward, up))
        inner_row, outer_row, us = [], [], []
        for j in range(EAR_WIDTH_SEGMENTS):
            u = -1.0 + 2.0 * j / (EAR_WIDTH_SEGMENTS - 1)
            dx = u * (width / 2.0)
            dish = cup * (1.0 - u * u)
            inner_pt = center + Vector((dx, -dish, 0.0))
            outer_pt = center + Vector((dx, -EAR_THICKNESS - EAR_BACK_BULGE * dish, 0.0))
            inner_row.append(inner_pt)
            outer_row.append(outer_pt)
            us.append(u)
        inner_rows.append(inner_row)
        outer_rows.append(outer_row)
        u_rows.append(us)

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    inner_v = [[bm.verts.new(p) for p in row] for row in inner_rows]
    outer_v = [[bm.verts.new(p) for p in row] for row in outer_rows]

    def quad(a, b, c, d, mat_index):
        f = bm.faces.new((a, b, c, d))
        f.material_index = mat_index
        return f

    t_lo, t_hi = EAR_INNER_T
    for i in range(EAR_LEN_SEGMENTS - 1):
        t_mid = (i + 0.5) / (EAR_LEN_SEGMENTS - 1)
        for j in range(EAR_WIDTH_SEGMENTS - 1):
            u_mid = abs((u_rows[i][j] + u_rows[i][j + 1]) / 2.0)
            is_inner = (u_mid <= EAR_INNER_U) and (t_lo <= t_mid <= t_hi)
            quad(inner_v[i][j], inner_v[i][j + 1], inner_v[i + 1][j + 1], inner_v[i + 1][j],
                 1 if is_inner else 0)
            quad(outer_v[i][j + 1], outer_v[i][j], outer_v[i + 1][j], outer_v[i + 1][j + 1], 0)
        # stitch the two open side rims (inner<->outer) shut
        quad(outer_v[i][0], outer_v[i + 1][0], inner_v[i + 1][0], inner_v[i][0], 0)
        quad(inner_v[i][-1], inner_v[i + 1][-1], outer_v[i + 1][-1], outer_v[i][-1], 0)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(fur_mat)
    mesh.materials.append(inner_mat)
    for poly in mesh.polygons:
        poly.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def make_ear_materials():
    fur_rgb = colorsys.hsv_to_rgb(SILVER_HAIR_HUE, 0.10, 0.90)
    fur = bpy.data.materials.new("EarFur")
    fur.use_nodes = True
    bsdf = fur.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*fur_rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55

    inner = bpy.data.materials.new("EarInner")
    inner.use_nodes = True
    bsdf2 = inner.node_tree.nodes["Principled BSDF"]
    bsdf2.inputs["Base Color"].default_value = (0.88, 0.58, 0.60, 1.0)
    bsdf2.inputs["Roughness"].default_value = 0.5
    return fur, inner


def build_ears(armature_obj):
    head_world = bw.head_bone_world(armature_obj)
    base_pos = head_world + Vector((0.0, -0.006, 0.145))
    fur_mat, inner_mat = make_ear_materials()

    ears = []
    for name, side, x_off in (("EarR", 1, 0.052), ("EarL", -1, -0.052)):
        anchor = base_pos + Vector((x_off, 0.0, 0.0))
        obj = build_ear(name, side, anchor, fur_mat, inner_mat)
        vg = obj.vertex_groups.new(name="J_Bip_C_Head")
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        obj.parent = armature_obj
        obj.matrix_parent_inverse = armature_obj.matrix_world.inverted()
        mod = obj.modifiers.new("Armature", type="ARMATURE")
        mod.object = armature_obj
        ears.append(obj)
    log(f"ears built: {[o.name for o in ears]}, base_pos={tuple(base_pos)}")
    return ears


# --- Summer outfit recolour ----------------------------------------------
# Cheap-but-effective texture recolour rather than new geometry: gold-tint
# the cardigan (masked to its own low-saturation cream fabric so the blue
# ribbon/tan buttons -- already only ~3% of the map -- pass through
# untouched), and lift the black camisole painted into the skin atlas to a
# pale sky blue (masked by hue: measured at 240-260deg vs. the leggings'
# unrelated warm-brown cluster at 0-20deg, so this can't bleed onto them).

CARDIGAN_TINT = np.array([0.97, 0.78, 0.40])
CARDIGAN_SAT_MAX = 0.20
CARDIGAN_STRIPE_PERIOD = 26.0    # px, in UV space; the panels run roughly
CARDIGAN_STRIPE_DEPTH = 0.07     # upright in this atlas, so this reads as a
                                 # vertical woven stripe like the reference's robe

# The camisole is picked out by being NEUTRAL and dark, not by hue: measured
# over Body_00, the leggings/shoes are a warm brown (hue 0-45, saturation
# 0.25-0.5) while the camisole is a near-colourless charcoal (saturation
# under 0.03). An earlier hue-band attempt here selected 319 pixels out of
# the ~81k that are actually camisole -- checked by rendering the mask out
# as an image and looking at it, which is the only way this kind of guess
# gets caught.
CAMISOLE_VALUE_MIN = 0.06
CAMISOLE_VALUE_MAX = 0.50
CAMISOLE_SAT_MAX = 0.12
CAMISOLE_TARGET_HUE = 0.585      # ~211 deg, a cornflower/sky blue
CAMISOLE_TARGET_SAT = 0.20
CAMISOLE_VALUE_LIFT = 0.82       # dark charcoal -> near-white with a blue cast
FLOWER_SPACING = 54.0            # px between motif centres
FLOWER_RADIUS = 15.0             # px
FLOWER_SAT = 0.50                # the printed flowers sit deeper/bluer
FLOWER_VALUE = 0.72


def _pixel_grid(shape):
    ys, xs = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    return ys, xs


def tint_cardigan_gold(img):
    """Multiply-tint rather than hue-rotate: the cardigan is near-white, and
    a hue rotation of a desaturated pixel does nothing. Masked to its own
    low-saturation cream fabric, so the blue ribbons and tan buttons (only
    ~3% of the map, all well above this saturation cut) pass through."""
    arr = bb.load_pixels(img)
    rgb, alpha = arr[..., :3], arr[..., 3]
    _, s, _ = bb.rgb_to_hsv(rgb)
    mask = (alpha > 0.5) & (s < CARDIGAN_SAT_MAX)

    _, xs = _pixel_grid(rgb.shape[:2])
    stripe = 1.0 + CARDIGAN_STRIPE_DEPTH * np.sin(xs * (2 * math.pi / CARDIGAN_STRIPE_PERIOD))
    tinted = np.clip(rgb * CARDIGAN_TINT * stripe[..., None], 0.0, 1.0)
    out = np.where(mask[..., None], tinted, rgb)
    bb.store_pixels(img, np.concatenate([out, alpha[..., None]], axis=-1))
    return int(mask.sum())


def _flower_field(shape):
    """A tiled field of small five-petal motifs, as a boolean mask plus a
    separate mask for their centres -- enough to read as a printed cotton
    yukata fabric at render distance without hand-painting a texture."""
    ys, xs = _pixel_grid(shape)
    cy = (ys % FLOWER_SPACING) - FLOWER_SPACING / 2.0
    cx = (xs % FLOWER_SPACING) - FLOWER_SPACING / 2.0
    # offset every other row so the motifs sit in a half-drop repeat
    row = np.floor(ys / FLOWER_SPACING)
    cx = cx + np.where(row % 2 > 0, FLOWER_SPACING / 2.0, 0.0)
    cx = ((cx + FLOWER_SPACING / 2.0) % FLOWER_SPACING) - FLOWER_SPACING / 2.0

    r = np.sqrt(cx * cx + cy * cy)
    theta = np.arctan2(cy, cx)
    petal_r = FLOWER_RADIUS * (0.45 + 0.55 * np.abs(np.cos(2.5 * theta)))
    return r <= petal_r, r <= FLOWER_RADIUS * 0.22


def recolour_camisole_blue(img):
    arr = bb.load_pixels(img)
    rgb, alpha = arr[..., :3], arr[..., 3]
    h, s, v = bb.rgb_to_hsv(rgb)
    mask = ((alpha > 0.5) & (v >= CAMISOLE_VALUE_MIN) & (v <= CAMISOLE_VALUE_MAX)
            & (s < CAMISOLE_SAT_MAX))

    petals, centres = _flower_field(rgb.shape[:2])
    # Keep the garment's own shading by carrying `v` through the lift; the
    # print only changes hue/saturation/brightness *within* the mask.
    base_v = v + (1.0 - v) * CAMISOLE_VALUE_LIFT
    h2 = np.where(mask, CAMISOLE_TARGET_HUE, h)
    s2 = np.where(mask, CAMISOLE_TARGET_SAT, s)
    v2 = np.where(mask, base_v, v)
    flower = mask & petals
    s2 = np.where(flower, FLOWER_SAT, s2)
    v2 = np.where(flower, base_v * FLOWER_VALUE, v2)
    heart = mask & centres
    s2 = np.where(heart, 0.55, s2)
    h2 = np.where(heart, 0.13, h2)   # a small warm yellow eye in each flower
    v2 = np.where(heart, base_v, v2)

    r, g, b = bb.hsv_to_rgb(h2, s2, v2)
    final = np.where(mask[..., None], np.stack([r, g, b], axis=-1), rgb)
    bb.store_pixels(img, np.concatenate([final, alpha[..., None]], axis=-1))
    return int(mask.sum())


# --- Bare legs / bare feet -------------------------------------------------
# The opaque tights and the loafers are winter legwear, and the final shot
# puts her legs and feet front and centre on a sun-baked veranda. The tights
# are painted into the body skin atlas (not separate geometry), so they come
# off as a recolour; the loafers ARE separate geometry -- 540 polygons on the
# Body mesh carrying their own Shoes material -- so those just get deleted,
# revealing the feet the base mesh already models underneath.
LEG_WARM_MAX_DEG = 45.0
LEG_WARM_MIN_DEG = 325.0
LEG_VALUE_MAX = 0.76       # the lightened skin sits at 0.88+; the tights,
LEG_SAT_MIN = 0.10         # including their sheen, stay under this
SKIN_REF_VALUE_MIN = 0.88
LEG_CLOSE_ITERS = 4        # morphological closing, in px
LEG_SHADE_SPREAD = 0.09    # how much form shading survives the repaint


def _close_mask(mask, iterations):
    """Binary closing (dilate then erode) with numpy rolls. The colour mask
    alone leaves pinholes and streaks where the tights' seams and specular
    highlights fall outside the hue/value window; closing swallows them, so
    the repaint covers the leg as a region instead of as a set of pixels
    that happened to be the right brown."""
    def shift_or(m):
        out = m.copy()
        for axis in (0, 1):
            for d in (1, -1):
                out |= np.roll(m, d, axis=axis)
        return out

    def shift_and(m):
        out = m.copy()
        for axis in (0, 1):
            for d in (1, -1):
                out &= np.roll(m, d, axis=axis)
        return out

    grown = mask
    for _ in range(iterations):
        grown = shift_or(grown)
    for _ in range(iterations):
        grown = shift_and(grown)
    return grown


def bare_legs(img):
    """Repaint the tights as skin, matched to this model's own skin rather
    than to a hardcoded colour: the reference tone is measured from the pale
    warm pixels of the same atlas (the arms and torso), so it tracks whatever
    build_model.py's skin lightening produced."""
    arr = bb.load_pixels(img)
    rgb, alpha = arr[..., :3], arr[..., 3]
    h, s, v = bb.rgb_to_hsv(rgb)
    deg = h * 360.0
    warm = (deg <= LEG_WARM_MAX_DEG) | (deg >= LEG_WARM_MIN_DEG)

    skin_ref = warm & (v >= SKIN_REF_VALUE_MIN) & (alpha > 0.5)
    if skin_ref.sum() < 1000:
        log("WARNING: too little reference skin found; leaving legwear alone")
        return 0
    skin_h = float(np.median(h[skin_ref]))
    skin_s = float(np.median(s[skin_ref]))
    skin_v = float(np.median(v[skin_ref]))

    seed = warm & (v < LEG_VALUE_MAX) & (s > LEG_SAT_MIN) & (alpha > 0.5)
    mask = _close_mask(seed, LEG_CLOSE_ITERS) & (alpha > 0.5)

    # Land on the arms' own tone and keep only a little of the legwear's
    # form shading, so the legs don't read as a tanner person below the hem.
    shade = np.clip(v / LEG_VALUE_MAX, 0.0, 1.0) ** 0.65
    remapped = np.clip(skin_v - LEG_SHADE_SPREAD * (1.0 - shade), 0.0, 1.0)

    h2 = np.where(mask, skin_h, h)
    s2 = np.where(mask, skin_s, s)
    v2 = np.where(mask, remapped, v)
    r, g, b = bb.hsv_to_rgb(h2, s2, v2)
    final = np.where(mask[..., None], np.stack([r, g, b], axis=-1), rgb)
    bb.store_pixels(img, np.concatenate([final, alpha[..., None]], axis=-1))
    log(f"bare legs: skin ref hsv=({skin_h:.3f},{skin_s:.3f},{skin_v:.3f}); "
        f"{int(seed.sum())} px by colour, {int(mask.sum())} after closing")
    return int(mask.sum())


FLOOR_ISLAND_MAX_Z = 0.15   # nothing of hers but the feet lives this low


def remove_floor_islands():
    """Delete VRoid's fake-shadow mesh from under her feet.

    It is a separate shell of geometry ringing the character at floor level
    (radius 0.19-0.31m, z from -0.055 up to ~0.09), weighted to the foot
    bones, and it is what `character_bounds()` kept finding as the lowest
    point -- so "feet at Z=0" was really "shadow mesh at Z=0", leaving the
    actual soles floating 4.6cm in the air. It also renders: it's the soft
    dark blotch that shows on the ground in a test render, and on a sunlit
    deck it would have read as a grubby smear.

    Identified by connectivity rather than by a radius/height box, because
    it is not a flat disc and any box that caught all of it also clipped
    toes. Her body is one big connected shell running up to the head, so
    "a connected component that never rises above ankle height" is exactly
    the junk and nothing else.
    """
    removed = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name not in CHARACTER_MESH_NAMES:
            continue
        mw = obj.matrix_world
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()

        seen = set()
        doomed = []
        for face in bm.faces:
            if face.index in seen:
                continue
            # flood fill this connected component
            stack, component = [face], []
            seen.add(face.index)
            while stack:
                f = stack.pop()
                component.append(f)
                for edge in f.edges:
                    for nb in edge.link_faces:
                        if nb.index not in seen:
                            seen.add(nb.index)
                            stack.append(nb)
            top = max((mw @ v.co).z for f in component for v in f.verts)
            if top < FLOOR_ISLAND_MAX_Z:
                doomed.extend(component)

        if doomed:
            removed += len(doomed)
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(obj.data)
            obj.data.update()
        bm.free()
    log(f"floor-level shadow islands removed: {removed} polygons")
    return removed


def remove_shoes():
    """Delete the loafer geometry (its own material on the Body mesh)."""
    removed = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        shoe_slots = {i for i, slot in enumerate(obj.material_slots)
                      if slot.material and "Shoes" in slot.material.name}
        if not shoe_slots:
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        doomed = [f for f in bm.faces if f.material_index in shoe_slots]
        removed += len(doomed)
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    log(f"shoes removed: {removed} polygons")
    return removed


def recolour_outfit_summer():
    """Cardigan -> warm gold robe; camisole and shorts -> one white-and-blue
    floral under-layer, so they read as a single summer garment set rather
    than three separate recoloured pieces."""
    tops = bpy.data.images.get("F00_006_01_Tops_01")
    body = bpy.data.images.get("F00_000_00_Body_00")
    bottoms = bpy.data.images.get("F00_008_01_Bottoms_01")
    if tops:
        log(f"cardigan gold-tinted: {tint_cardigan_gold(tops)} px")
    else:
        log("WARNING: Tops_01 image not found, skipping cardigan tint")
    if body:
        log(f"camisole -> white/blue floral: {recolour_camisole_blue(body)} px")
    else:
        log("WARNING: Body_00 image not found, skipping camisole recolour")
    if bottoms:
        # Same neutral-dark mask: the shorts are black cloth, the belt is a
        # saturated tan and survives untouched.
        log(f"shorts -> white/blue floral: {recolour_camisole_blue(bottoms)} px")
    else:
        log("WARNING: Bottoms_01 image not found, skipping shorts recolour")
    if body:
        bare_legs(body)
    remove_shoes()
    remove_floor_islands()


# --- Bounds + root -----------------------------------------------------

def character_bounds():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name not in CHARACTER_MESH_NAMES:
            continue
        eval_obj = obj.evaluated_get(depsgraph)
        mesh = eval_obj.to_mesh()
        if len(mesh.vertices) == 0:
            eval_obj.to_mesh_clear()
            continue
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


def sole_z():
    """World Z of the lowest *visible* point of her feet.

    Not the same as the mesh's lowest vertex: the Bottoms garment carries
    over-knee sock geometry that reaches to z=-0.055, below the soles, and
    is invisible only because that region of its texture is fully
    transparent. It shares a connected shell with the shorts, so it can't
    be deleted -- but it must not define where the floor is, or she stands
    10cm in the air. The bare feet are skin, so the skin material's lowest
    vertex is the real ground contact.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lowest = None
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name not in CHARACTER_MESH_NAMES:
            continue
        skin_slots = {i for i, slot in enumerate(obj.material_slots)
                      if slot.material and "SKIN" in slot.material.name}
        if not skin_slots:
            continue
        eval_obj = obj.evaluated_get(depsgraph)
        mesh = eval_obj.to_mesh()
        world = np.array(eval_obj.matrix_world)
        coords = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", coords)
        pts = coords.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3]
        used = {vi for poly in mesh.polygons if poly.material_index in skin_slots
                for vi in poly.vertices}
        if used:
            z = float(pts[sorted(used), 2].min())
            lowest = z if lowest is None else min(lowest, z)
        eval_obj.to_mesh_clear()
    return lowest


def build_character():
    """Build the finished character into the current scene. No lighting,
    world, camera, or posing -- the caller (a composition step, or this
    file's own __main__ test path) supplies that. Returns (root, armature)."""
    armature, _grafted_hair = graft_silver_hair()
    build_ears(armature)
    recolour_outfit_summer()

    bb.convert_all_materials()
    bb.shade_smooth_all()

    root = bpy.data.objects.new("CharacterRoot", None)
    bpy.context.collection.objects.link(root)
    armature.parent = root
    armature.matrix_parent_inverse = root.matrix_world.inverted()

    mn, mx = character_bounds()
    ground = sole_z()
    if ground is None:
        log("WARNING: no skin geometry found to stand on; falling back to mesh minimum")
        ground = mn.z
    root.location = (0.0, 0.0, -ground)
    log(f"character bounds (pre feet-to-zero shift): {tuple(mn)} {tuple(mx)}; "
        f"visible sole at {ground:.4f}, root lifted by {-ground:.4f}")

    return root, armature


# --- Standalone test-render path ------------------------------------------

def pose_test_arms():
    """Test-render-only: relaxed at-the-sides arms, exactly like
    blender_build.pose_relaxed_arms() -- see that function's docstring and
    this module's docstring for the measured axis/sign."""
    bb.pose_relaxed_arms()


def main():
    # Standalone only: start from a genuinely empty scene, so Blender's
    # startup Cube/Camera/Light don't end up in the test renders. When this
    # module is imported the caller's scene is left exactly as it is.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if bpy.context.scene.world is None:
        # use_empty=True leaves no world datablock, and the shared lighting
        # helper expects one to hang its background shader on.
        bpy.context.scene.world = bpy.data.worlds.new("TestWorld")
    os.makedirs(OUT_DIR, exist_ok=True)
    root, armature = build_character()
    pose_test_arms()

    # character_bounds() reads full-hierarchy evaluated world positions, so
    # this already reflects both the feet-to-zero shift baked into `root`
    # and the just-applied test pose -- no further offset needed here.
    mn, mx = character_bounds()
    log("post-pose bounds:", tuple(mn), tuple(mx))

    bb.build_cove_backdrop(mn, mx)
    bb.build_lighting(mn, mx)
    bb.configure_render_engine()

    height = mx.z - mn.z
    y_mid = (mn.y + mx.y) / 2

    bust_lens = 100
    bust_top = mx.z + height * 0.05
    bust_bottom = mn.z + height * 0.62
    bust_dist = bb.vertical_fit_distance(bust_lens, bust_top - bust_bottom, target_frac=0.95)
    bust_mid_z = (bust_top + bust_bottom) / 2
    bb.setup_camera("BustCam", (0.0, mx.y + bust_dist, bust_mid_z), (0, y_mid, bust_mid_z), lens=bust_lens)
    bb.render_to(os.path.join(OUT_DIR, "char_summer_bust.png"), 1024, 1280)

    full_lens = 50
    full_top = mx.z + height * 0.08
    full_bottom = mn.z - height * 0.02
    full_dist = bb.vertical_fit_distance(full_lens, full_top - full_bottom, target_frac=0.88)
    full_mid_z = (full_top + full_bottom) / 2
    full_target_z = mn.z + height * 0.52
    yaw = math.radians(35)
    full_cam = (full_dist * math.sin(yaw), y_mid + full_dist * math.cos(yaw), full_mid_z)
    bb.setup_camera("FullCam", full_cam, (0, y_mid, full_target_z), lens=full_lens)
    bb.render_to(os.path.join(OUT_DIR, "char_summer_full.png"), 1080, 1440)

    log("done")


if __name__ == "__main__":
    main()
