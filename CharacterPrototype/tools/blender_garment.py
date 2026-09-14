"""A yukata worn open and off the shoulders, built as geometry on the rig.

The outfit she has is the base model's own cardigan and dress with the textures
recoloured, which can change what colour a garment is but never what shape it
is. The reference's whole upper half is a different shape: a yukata slipped off
both shoulders, hanging open, with the wide sleeves around her upper arms and
the body of it pooling behind her. No amount of repainting reaches that.

What makes a yukata read as a yukata is the collar band -- the strip that comes
over the shoulders and crosses left over right down the chest. Get that wrong
and wide sleeves on an open robe just read as a dressing gown, so the collar is
the piece that gets the most attention here.

Paths are written in her standing rest-pose world space, in metres, and the
pieces are then parented to the bones they hang from, so they follow the pose.
She faces +Y.

    blender --background --python tools/blender_garment.py
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
OUT_DIR = os.path.join(PROJECT, "assets", "blender")

from blender_hair import catmull_rom, parallel_frames  # noqa: E402  (same repo)

TAU = math.pi * 2

# --- Where the garment sits --------------------------------------------------
# Worn OFF the shoulders, so every path here is lower and wider than a yukata
# actually fastened at the neck would be: the collar crosses the upper arms
# rather than the collarbone, which is the whole look.
# Standing clear of the skin on purpose. The first pass put these at the chest
# surface itself and the whole collar rendered as nothing at all, buried inside
# her -- cloth needs to sit ON the body, not in its skin.
COLLAR_LEFT = [
    (0.155, 0.020, 1.180),   # out at her left upper arm, where it has slipped to
    (0.120, 0.105, 1.140),   # forward over the chest
    (0.055, 0.122, 1.055),   # crossing toward the centre
    (0.000, 0.112, 0.985),   # left panel crosses UNDER the right at the waist
]
COLLAR_RIGHT = [
    (-0.155, 0.020, 1.180),
    (-0.120, 0.108, 1.145),
    (-0.050, 0.128, 1.060),
    (0.012, 0.122, 0.980),   # right panel rides OVER, as a yukata is worn
]
# Round the back of the neck, joining the two front bands into one collar.
COLLAR_BACK = [
    (0.150, 0.020, 1.180), (0.110, -0.060, 1.215), (0.0, -0.085, 1.225),
    (-0.110, -0.060, 1.215), (-0.150, 0.020, 1.180),
]

# Wide, and in the robe's own cloth rather than a contrast trim. The first
# version was a 3.6cm cream band over a pale blue swimsuit -- measurement
# confirmed it was sitting correctly in front of her chest (y=0.136 against a
# body surface at y=0.099), so it was never mispositioned; it simply had no
# contrast and no width to be seen with. A yukata collar reads as the EDGE of
# the garment, which means it has to look continuous with the panels it closes.
COLLAR_WIDTH = 0.058
COLLAR_THICK = 0.010

# Sleeves hang off the upper arms as open tubes. Yukata sleeves are wide and
# square-ish rather than fitted, so these are much larger than the arm.
# Sleeves run ALONG the arm rather than dangling off it, because they are
# parented to the upper-arm bone and follow it once she is posed. Length is
# kept well clear of width on purpose: this project has already learned once
# (NOTES_vrm_lessons.md) that a cylinder whose length and diameter are the same
# order reads, viewed near its own axis, as a flat slab -- last time a sleeve
# became a wing, and the first pass here repeated it exactly.
SLEEVES = {
    "L": [(0.150, 0.012, 1.180), (0.255, 0.018, 1.168), (0.360, 0.026, 1.150)],
    "R": [(-0.150, 0.012, 1.180), (-0.255, 0.018, 1.168), (-0.360, 0.026, 1.150)],
}
SLEEVE_RADIUS = (0.058, 0.082)     # narrower at the shoulder, flaring to the cuff

# The body of the robe, hanging from the collar down her back and sides.
BACK_PANEL_TOP = [(0.150, 0.015, 1.175), (0.0, -0.085, 1.215), (-0.150, 0.015, 1.175)]
BACK_PANEL_DROP = 0.52
BACK_PANEL_FLARE = 1.35            # widens toward the hem, the way cloth falls

OBI = [(0.0, 0.105, 0.975)]        # a sash across the front at the waist
OBI_WIDTH = 0.085
OBI_THICK = 0.020

BONES = {
    "collar": "J_Bip_C_UpperChest",
    "back": "J_Bip_C_Chest",
    "obi": "J_Bip_C_Spine",
    "sleeveL": "J_Bip_L_UpperArm",
    "sleeveR": "J_Bip_R_UpperArm",
}


def log(*a):
    print("[garment]", *a)


def _finish(bm, name, material=None):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    return obj


def build_band(name, path, width, thickness, samples_per_span=12, material=None,
               taper_end=1.0):
    """Sweep a flat rectangle along a path -- a strip of folded cloth.

    Rectangular rather than round because a collar is a folded band with two
    faces and an edge; swept as a tube it reads as piping or as a rope trim.
    """
    spine = catmull_rom(path, samples_per_span)
    frames = parallel_frames(spine)
    count = len(spine)

    bm = bmesh.new()
    rings = []
    for i, (point, (_, normal, binormal)) in enumerate(zip(spine, frames)):
        t = i / max(count - 1, 1)
        w = width * (1 + (taper_end - 1) * t) * 0.5
        d = thickness * 0.5
        rings.append([bm.verts.new(point + normal * sx * w + binormal * sy * d)
                      for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for a, b in zip(rings, rings[1:]):
        for s in range(4):
            n = (s + 1) % 4
            bm.faces.new((a[s], a[n], b[n], b[s]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[-1]))
    return _finish(bm, name, material)


def build_sleeve(name, path, radii, samples_per_span=10, segments=12,
                 material=None):
    """An open tube for a sleeve: no caps, so it reads as something to see into."""
    spine = catmull_rom(path, samples_per_span)
    frames = parallel_frames(spine)
    count = len(spine)
    start, end = radii

    bm = bmesh.new()
    rings = []
    for i, (point, (_, normal, binormal)) in enumerate(zip(spine, frames)):
        t = i / max(count - 1, 1)
        radius = start + (end - start) * t
        ring = []
        for s in range(segments):
            a = TAU * s / segments
            # Squashed slightly across the body, since a hanging sleeve is not
            # a circular pipe -- it collapses under its own weight.
            ring.append(bm.verts.new(point
                                     + normal * (math.cos(a) * radius)
                                     + binormal * (math.sin(a) * radius * 0.72)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for s in range(segments):
            n = (s + 1) % segments
            bm.faces.new((a[s], a[n], b[n], b[s]))
    return _finish(bm, name, material)


def build_back_panel(name, top_path, drop, flare, samples_per_span=14,
                     rows=10, material=None):
    """The body of the robe: a sheet hanging from the shoulder line.

    Widened toward the hem and pushed back as it falls, because cloth hanging
    off a body swings out rather than dropping in a straight cylinder.
    """
    top = catmull_rom(top_path, samples_per_span)
    centre_x = sum(p.x for p in top) / len(top)

    bm = bmesh.new()
    grid = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for point in top:
            spread = 1 + (flare - 1) * t
            x = centre_x + (point.x - centre_x) * spread
            # A gentle sag: the hem hangs further back than the shoulders.
            y = point.y - 0.055 * t * t
            z = point.z - drop * t
            row.append(bm.verts.new(Vector((x, y, z))))
        grid.append(row)
    for a, b in zip(grid, grid[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    return _finish(bm, name, material)


# The base model's own tops, which have to come off before a yukata can be
# seen. Deleting the faces that use this material is the whole operation --
# VRoid keeps each garment on its own material, so the cardigan is separable
# from the body underneath it without touching anything else.
TOPS_MATERIAL = "Tops"


def strip_garment(material_substring=TOPS_MATERIAL):
    """Delete the faces wearing a given material, across every mesh.

    The first pass built the yukata over her existing cardigan and every piece
    of it -- collar, front panels, obi -- disappeared underneath. A garment
    cannot be layered onto a body that is already dressed.
    """
    removed = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        slots = [i for i, sl in enumerate(obj.material_slots)
                 if sl.material and material_substring in sl.material.name]
        if not slots:
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        doomed = [f for f in bm.faces if f.material_index in slots]
        removed += len(doomed)
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    log(f"stripped {removed} faces matching '{material_substring}'")
    return removed


def parent_to_bone(obj, armature, bone_name):
    """Hang a piece off a bone without it jumping when the parent is set."""
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def cloth_material(name, colour, roughness=0.72):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


# Summer yukata colours, picked to sit with the blue already on her.
YUKATA_CLOTH = (0.86, 0.70, 0.30)
YUKATA_COLLAR = (0.96, 0.94, 0.88)
OBI_CLOTH = (0.16, 0.22, 0.48)


def build_yukata(armature, cloth=None, collar=None, obi=None):
    """Every piece, parented to the bone it hangs from. Returns the objects."""
    cloth = cloth or cloth_material("YukataCloth", YUKATA_CLOTH)
    collar = collar or cloth_material("YukataCollar", YUKATA_CLOTH, 0.66)
    obi = obi or cloth_material("YukataObi", OBI_CLOTH, 0.66)

    made = []
    for name, path in (("Yukata_CollarBack", COLLAR_BACK),
                       ("Yukata_CollarL", COLLAR_LEFT),
                       ("Yukata_CollarR", COLLAR_RIGHT)):
        piece = build_band(name, path, COLLAR_WIDTH, COLLAR_THICK,
                           material=collar, taper_end=0.85)
        parent_to_bone(piece, armature, BONES["collar"])
        made.append(piece)

    for key, path in SLEEVES.items():
        piece = build_sleeve(f"Yukata_Sleeve{key}", path, SLEEVE_RADIUS,
                             material=cloth)
        parent_to_bone(piece, armature, BONES[f"sleeve{key}"])
        made.append(piece)

    back = build_back_panel("Yukata_Back", BACK_PANEL_TOP, BACK_PANEL_DROP,
                            BACK_PANEL_FLARE, material=cloth)
    parent_to_bone(back, armature, BONES["back"])
    made.append(back)

    sash = build_band("Yukata_Obi",
                      [(0.115, 0.060, 0.975), (0.0, 0.105, 0.968),
                       (-0.115, 0.060, 0.975)],
                      OBI_WIDTH, OBI_THICK, material=obi)
    parent_to_bone(sash, armature, BONES["obi"])
    made.append(sash)

    log(f"built {len(made)} pieces: "
        + ", ".join(o.name.replace("Yukata_", "") for o in made))
    return made


if __name__ == "__main__":
    import blender_character

    bpy.ops.wm.read_factory_settings(use_empty=True)
    import blender_compose

    root, arm = blender_character.build_character()
    strip_garment()
    # Pose her BEFORE judging the garment. In the T-pose her arms are
    # horizontal, so a sleeve running along the arm is seen end-on and reads as
    # a flat slab -- which sent the first pass chasing a shape problem that
    # only existed in the bind pose. The sleeves hang off the arm bones and
    # follow them down as soon as she is actually sitting.
    blender_compose.apply_pose(arm, blender_compose.POSE_SEATED)
    build_yukata(arm)
    for obj in bpy.data.objects:
        if obj.type == "MESH" and any(k in obj.name for k in ("Hair", "Ear")):
            obj.visible_shadow = False

    key = bpy.data.lights.new("Key", type="AREA")
    key.energy, key.size = 400, 1.8
    ko = bpy.data.objects.new("Key", key)
    bpy.context.scene.collection.objects.link(ko)
    ko.location = (1.1, 1.7, 2.0)
    ko.rotation_euler = (Vector((0, 0, 0.95)) - Vector(ko.location)
                         ).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.35, 0.40, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.1
    bpy.context.scene.world = world

    cam_data = bpy.data.cameras.new("C")
    cam_data.lens = 55
    cam = bpy.data.objects.new("C", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0.42, 1.95, 1.15)
    cam.rotation_euler = (Vector((0, 0, 0.95)) - Vector(cam.location)
                          ).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.samples = 70
    scene.render.resolution_x, scene.render.resolution_y = 760, 950
    scene.view_settings.view_transform = "Filmic"
    os.makedirs(OUT_DIR, exist_ok=True)
    scene.render.filepath = os.path.join(OUT_DIR, "garment_test.png")
    bpy.ops.render.render(write_still=True)
    log("wrote", scene.render.filepath)
