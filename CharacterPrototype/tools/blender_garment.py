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


# --- Reshaping her own cardigan ---------------------------------------------
# Measured off the base model in the rest pose: the tops are 1758 vertices,
# every one of them exclusive to the garment (not a single vertex shared with
# the skin), so they can be moved freely without tearing her open. The body of
# the cardigan sits inside |x| < 0.20 spanning z 0.79-1.38; beyond that it is
# the sleeve, a tube about 13cm across running out to the wrist at x = 0.567.
#
# Reshaping that beats replacing it. The cardigan is real cloth geometry --
# it fits the body, it has topology and UVs and weights, and it deforms with
# the pose because it is skinned. Geometry built from scratch to stand in for
# it has none of that, which is exactly why the first yukata read as cut card.
ARM_CENTRE_Z = 1.222      # the sleeve tube's centreline in the rest pose
SLEEVE_START_X = 0.200    # outboard of this, the tops are sleeve rather than body
SLEEVE_END_X = 0.567
HEM_START_Z = 0.900       # below this, the hem is stretched downward

# Slipping it off the shoulders. The neckline is dropped and spread at the same
# time: dropped alone it slides down her front still gripping her neck, which
# reads as a garment that has been pulled on badly rather than one worn open.
# Spreading it is what puts the opening out around the upper arms.
SHOULDER_Z = 1.235        # above this, the tops are neckline and shoulder
SHOULDER_TOP_Z = 1.376    # the highest vertex of the collar
SHOULDER_SLIP = 0.135     # how far the neckline falls
SHOULDER_SPREAD = 0.60    # how much wider the opening gets as it falls

# Tuned down from 2.10/0.36/0.60 after seeing them in the shot: at those values
# the sleeve outgrew the figure and the whole garment read as a flared yellow
# dress rather than a robe. A tamoto is wide against the arm, not against the
# body, so the flare stops where the sleeve is still narrower than her hips.
SLEEVE_FLARE = 1.35       # how much the sleeve's cross-section grows at the cuff
SLEEVE_HANG = 0.260       # how far the underside drops -- this is the tamoto
SLEEVE_DEPTH = 0.42       # front-to-back widening, so it is a pouch not a fin
HEM_DROP = 0.300          # a robe falls past the hip; a cardigan stops at it


def reshape_tops_into_yukata(material_substring=TOPS_MATERIAL,
                             flare=SLEEVE_FLARE, hang=SLEEVE_HANG,
                             depth=SLEEVE_DEPTH, hem_drop=HEM_DROP,
                             slip=SHOULDER_SLIP, spread=SHOULDER_SPREAD):
    """Pull her cardigan into the shape of a yukata, vertex by vertex.

    Three changes carry it. The sleeve's cross-section is flared as it runs
    outboard and its underside is dragged down, which turns a fitted tube into
    the hanging pouch a yukata sleeve actually is. The hem is stretched
    downward so the garment falls past the hip instead of stopping at it. And
    the neckline is dropped and spread together, which is what slips the whole
    thing off her shoulders.

    Edits the rest mesh, so the armature goes on deforming it as usual and the
    result still moves with the pose.
    """
    moved = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        slots = [i for i, sl in enumerate(obj.material_slots)
                 if sl.material and material_substring in sl.material.name]
        if not slots:
            continue

        mesh = obj.data
        garment, other = set(), set()
        for poly in mesh.polygons:
            (garment if poly.material_index in slots else other).update(poly.vertices)
        # Only vertices this garment owns outright. A vertex shared with the
        # skin would drag her body with the cloth.
        own = garment - other

        for index in own:
            vert = mesh.vertices[index]
            x, y, z = vert.co
            reach = abs(x)
            if reach > SLEEVE_START_X:
                t = min((reach - SLEEVE_START_X) / (SLEEVE_END_X - SLEEVE_START_X), 1.0)
                offset = z - ARM_CENTRE_Z
                z = ARM_CENTRE_Z + offset * (1 + flare * t)
                if offset < 0:
                    # Only the underside falls; the top stays on the shoulder.
                    z -= hang * t
                y *= 1 + depth * t
            elif z > SHOULDER_Z:
                u = min((z - SHOULDER_Z) / max(SHOULDER_TOP_Z - SHOULDER_Z, 1e-6), 1.0)
                z -= slip * u
                x *= 1 + spread * u
            elif z < HEM_START_Z:
                u = (HEM_START_Z - z) / max(HEM_START_Z - 0.790, 1e-6)
                z -= hem_drop * min(u, 1.0)
            else:
                continue
            vert.co = (x, y, z)
            moved += 1
        mesh.update()
    log(f"reshaped {moved} cardigan vertices into a yukata")
    return moved


# --- painting the trim onto the cloth itself ---------------------------------
# Modelled trim was tried twice and failed twice. Sitting at the body surface
# it vanished inside the cardigan; pushed clear of the cardigan it stopped
# looking like cloth and became a pale board floating over her lap. Both are
# the same mistake: a yukata's collar and obi are not objects laid on the robe,
# they are PART of the robe, with its folds and its shading. So they are
# painted here -- the cardigan's own faces along the collar line and around the
# waist are simply given a different material. Nothing is added, nothing can
# float, and the trim creases exactly as the cloth under it does.
# Narrow, and confined to one face of the cloth. The first pass matched purely
# on the path's shadow in x and z, which takes no view of which SIDE of her the
# face is on -- so the front bands claimed her back, the back band claimed her
# shoulders, and 1181 faces came out cream: she was wearing a white top.
COLLAR_PAINT_WIDTH = 0.026   # half-width of the band, measured across the cloth
COLLAR_FRONT_Y = 0.030       # front bands only paint cloth in front of this
COLLAR_BACK_Y = 0.010        # the back band only paints cloth behind this
# An open cardigan has two surfaces along its front edge -- the outside and the
# lining folded behind it -- and the band's shadow in x and z catches both, so
# a narrow collar still painted as a broad panel. Only cloth actually facing
# the viewer is trim; the lining behind it keeps the robe's colour.
COLLAR_FACING = 0.25
OBI_BAND = (0.940, 1.028)    # z range of the sash
OBI_MAX_REACH = 0.285        # outboard of this it is sleeve, not waist


def _segment_distance(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    length = dx * dx + dz * dz
    t = 0.0 if length < 1e-9 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / length))
    return math.hypot(px - (ax + dx * t), pz - (az + dz * t))


def _near_path(px, pz, path, width):
    return any(_segment_distance(px, pz, a[0], a[2], b[0], b[2]) < width
               for a, b in zip(path, path[1:]))


def _slot_for(obj, material):
    for i, slot in enumerate(obj.material_slots):
        if slot.material == material:
            return i
    obj.data.materials.append(material)
    return len(obj.data.materials) - 1


def paint_trim(collar_material, obi_material, material_substring=TOPS_MATERIAL,
               width=COLLAR_PAINT_WIDTH):
    """Recolour the cardigan's own faces into a crossed collar and an obi."""
    # (path, does this face belong to it?) -- the side test is what keeps each
    # band on its own face of the garment.
    collar_paths = (
        (COLLAR_LEFT, lambda c, n: c.y > COLLAR_FRONT_Y and n.y > COLLAR_FACING),
        (COLLAR_RIGHT, lambda c, n: c.y > COLLAR_FRONT_Y and n.y > COLLAR_FACING),
        (COLLAR_BACK, lambda c, n: c.y < COLLAR_BACK_Y and n.y < -COLLAR_FACING),
    )
    painted_collar = painted_obi = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        slots = [i for i, sl in enumerate(obj.material_slots)
                 if sl.material and material_substring in sl.material.name]
        if not slots:
            continue
        mesh = obj.data
        collar_slot = _slot_for(obj, collar_material)
        obi_slot = _slot_for(obj, obi_material)
        for poly in mesh.polygons:
            if poly.material_index not in slots:
                continue
            centre = poly.center
            if (OBI_BAND[0] <= centre.z <= OBI_BAND[1]
                    and abs(centre.x) < OBI_MAX_REACH):
                poly.material_index = obi_slot
                painted_obi += 1
            elif any(side(centre, poly.normal)
                     and _near_path(centre.x, centre.z, path, width)
                     for path, side in collar_paths):
                poly.material_index = collar_slot
                painted_collar += 1
        mesh.update()
    log(f"painted {painted_collar} faces as collar, {painted_obi} as obi")
    return painted_collar, painted_obi


def cloth_points(material_substring=TOPS_MATERIAL):
    """Every vertex the garment owns outright, in world space."""
    pts = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        slots = [i for i, sl in enumerate(obj.material_slots)
                 if sl.material and material_substring in sl.material.name]
        if not slots:
            continue
        mesh = obj.data
        garment, other = set(), set()
        for poly in mesh.polygons:
            (garment if poly.material_index in slots else other).update(poly.vertices)
        matrix = obj.matrix_world
        pts.extend(matrix @ mesh.vertices[i].co for i in garment - other)
    return pts


def drape(path, cloth, clearance=0.026, radius=0.080):
    """Lift an authored path out of whatever cloth is under it.

    The collar and sash were authored against the bare body, and then the
    widening pass and the sleeve flare moved the cardigan out past them -- so
    both ended up buried inside the robe they were meant to close, which is
    exactly the failure this file already hit once against the skin. Rather
    than re-guessing a y for every control point each time the body changes,
    each point is pushed to just clear of the nearest cloth surface found
    around it in x and z. The result is then smoothed, so a point whose
    neighbourhood happens to be crowded does not kink the band.
    """
    lifted = []
    for point in path:
        near = [c for c in cloth
                if (c.x - point[0]) ** 2 + (c.z - point[2]) ** 2 < radius ** 2]
        if not near:
            lifted.append(tuple(point))
            continue
        front, back = max(c.y for c in near), min(c.y for c in near)
        # Which face of the cloth this point belongs to, decided by which one
        # it was authored nearer to.
        if point[1] >= (front + back) * 0.5:
            y = max(point[1], front + clearance)
        else:
            y = min(point[1], back - clearance)
        lifted.append((point[0], y, point[2]))

    if len(lifted) < 3:
        return lifted
    smoothed = [lifted[0]]
    for i in range(1, len(lifted) - 1):
        y = (lifted[i - 1][1] + 2 * lifted[i][1] + lifted[i + 1][1]) / 4
        smoothed.append((lifted[i][0], y, lifted[i][2]))
    smoothed.append(lifted[-1])
    return smoothed


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
    """Give the reshaped cardigan the two things that make it read as a yukata.

    Deliberately small. Once the cardigan itself is pulled into a yukata it
    already supplies the sleeves, the body and the hem -- as real cloth, with
    folds and weights and a texture -- and generated stand-ins for those only
    competed with it. An earlier version built both, and she ended up with two
    sets of sleeves: the cardigan's on her arms, and a pair of pale boxes
    floating where her arms had been before she was posed.

    What a cardigan does not have is the crossed collar -- the single feature
    that makes a robe read as a yukata -- and a sash to close it. Both are
    painted onto the cardigan's own faces rather than modelled on top of it;
    see paint_trim for why the modelled version was abandoned.
    """
    del cloth, armature  # the robe supplies its own cloth, and nothing is parented
    collar = collar or cloth_material("YukataCollar", YUKATA_COLLAR, 0.66)
    obi = obi or cloth_material("YukataObi", OBI_CLOTH, 0.66)
    return paint_trim(collar, obi)


if __name__ == "__main__":
    import blender_character

    bpy.ops.wm.read_factory_settings(use_empty=True)
    import blender_compose

    root, arm = blender_character.build_character()
    reshape_tops_into_yukata()
    # Pose her BEFORE judging the garment. In the T-pose her arms are
    # horizontal, so a sleeve running along the arm is seen end-on and reads as
    # a flat slab -- which sent the first pass chasing a shape problem that
    # only existed in the bind pose. The sleeves hang off the arm bones and
    # follow them down as soon as she is actually sitting.
    build_yukata(arm)
    # Pose AFTER building. The paths above are rest-pose measurements, and the
    # pieces hang off bones, so the rig carries them into the pose. Built the
    # other way round they land where her arms used to be.
    blender_compose.apply_pose(arm, blender_compose.POSE_SEATED)
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
