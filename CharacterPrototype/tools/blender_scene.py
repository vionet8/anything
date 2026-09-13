#!/usr/bin/env python3
"""Procedural Japanese summer engawa (veranda) environment, built headless in Blender.

This is the *set*, not the cast: a traditional house opening onto a wooden
veranda deck, with a koi pond directly below the deck edge, on a bright,
sticky summer afternoon. A character from another workstream gets dropped onto
the deck, so the world conventions below are contractual.

Usage
-----
As a module::

    import blender_scene
    root = blender_scene.build_scene()      # returns the "Scene_Engawa" empty
    blender_scene.build_lighting()          # separate, so it can be overridden

Standalone (builds + renders its own two test frames)::

    blender --background --python tools/blender_scene.py

World conventions (Blender Z-up, real-world metres)
---------------------------------------------------
  * Deck TOP SURFACE is exactly Z = 0.0. A character lying on the deck needs
    no vertical offset.
  * The deck edge (deck meets water) runs along the X axis at Y = DECK_FRONT.
  * +Y is "into the house" (interior, shoji, tatami). -Y is out over the water,
    toward the camera.
  * Water surface sits at Z = WATER_LEVEL (-0.8).
  * The rectangle X in [-1.2, 1.2], Y in [-0.4, 0.9] on the deck is kept clear
    of props -- that is the character's footprint.
  * Everything is parented (directly or indirectly) to a single empty named
    "Scene_Engawa", so the whole set can be moved or hidden as one.
  * The sleeping cat hangs off its own empty, "Cat" (a child of Scene_Engawa),
    at X=1.54 Y=0.30 yawed 58 deg. Move/rotate that one empty to re-place it
    without touching anything else.
  * Deck spans X in [-4.30, 4.30], Y in [-0.75, 1.65]. The house opening
    (posts + sliding doors) is the plane Y = 1.65; tatami runs back to the far
    wall at Y = 3.95. The eave soffit is at Z = 3.05 and overhangs to Y = -0.70.

Composition notes (the reason the hero framing is what it is)
-------------------------------------------------------------
  * build_lighting() is deliberately separate and self-contained: sun,
    physical sky, the dapple gobo and three soft fills. SUN_ELEVATION /
    SUN_AZIMUTH at module level move the whole mood -- the eave's shadow line
    lands on the deck at Y = EAVE_FRONT + EAVE_Z / tan(elevation).
  * The dappled light is a large plane high above the set ("Engawa_Light_Gobo")
    that is invisible to camera and to indirect rays but still casts. It is
    what makes the deck read as a hot afternoon rather than an overcast one;
    pass build_lighting(dappled=False) to drop it.

Rendering notes for this environment (inherited from tools/blender_build.py)
---------------------------------------------------------------------------
  * Cycles only. Eevee mis-sorts the layered transparent quads (shoji paper,
    water, bamboo leaves) badly enough to be useless here.
  * Denoising must stay OFF -- this apt Blender build raises
    "RuntimeError: Build without OpenImageDenoiser". Compensate with samples.
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Vector, Euler, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = os.path.join(PROJECT, "assets", "blender")

# --------------------------------------------------------------------------
# World constants -- the contract with the character workstream.
# --------------------------------------------------------------------------
DECK_TOP = 0.0            # deck walking surface
DECK_THICK = 0.045        # plank thickness
DECK_FRONT = -0.75        # deck edge over the water (runs along X)
DECK_BACK = 1.65          # where the deck meets the house threshold
DECK_X = 4.30             # deck half-width
WATER_LEVEL = -0.80
POND_FLOOR = -1.95

TATAMI_TOP = 0.035        # interior floor, a touch proud of the deck
WALL_Y = 1.65             # plane of the sliding-door opening
BACK_WALL_Y = 3.95        # far interior wall (holds the renji window)
EAVE_Z = 3.05             # soffit height over the deck
EAVE_FRONT = -0.70        # how far the roof overhangs past the deck edge
ROOF_RIDGE_Y = 4.95
ROOF_RIDGE_Z = 4.62
POST_W = 0.11

CLEAR_X = (-1.2, 1.2)     # character footprint -- keep props out
CLEAR_Y = (-0.4, 0.9)

RENDER_SAMPLES = int(os.environ.get("ENGAWA_SAMPLES", "150"))
RENDER_SCALE = float(os.environ.get("ENGAWA_SCALE", "1.0"))

_created = []             # everything built this run, parented at the end
RNG = random.Random(20240811)


def log(*a):
    print("[engawa]", *a, flush=True)


# ==========================================================================
# Small mesh / material helpers
# ==========================================================================

def _register(obj):
    _created.append(obj)
    return obj


def new_object(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return _register(obj)


def obj_from_bmesh(name, bm, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    return new_object(name, mesh)


def bm_box(bm, center, size, rot=None):
    """Axis-aligned (optionally rotated) box appended into an existing bmesh."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    mat = Matrix.Translation(center)
    if rot is not None:
        mat = mat @ Euler(rot, "XYZ").to_matrix().to_4x4()
    verts = []
    for dx in (-sx, sx):
        for dy in (-sy, sy):
            for dz in (-sz, sz):
                verts.append(bm.verts.new(mat @ Vector((dx, dy, dz)) - Vector(center) + Vector(center)))
    # index order: (dx,dy,dz) -> 0..7 with dz fastest
    v = verts
    quads = [
        (0, 1, 3, 2),  # -x
        (4, 6, 7, 5),  # +x
        (0, 4, 5, 1),  # -y
        (2, 3, 7, 6),  # +y
        (1, 5, 7, 3),  # +z
        (0, 2, 6, 4),  # -z
    ]
    for q in quads:
        bm.faces.new([v[i] for i in q])
    return verts


def box_obj(name, center, size, rot=None, mat=None, smooth=False):
    bm = bmesh.new()
    bm_box(bm, center, size, rot)
    obj = obj_from_bmesh(name, bm, smooth=smooth)   # bm_box baked the rotation
    if mat:
        obj.data.materials.append(mat)
    return obj


def bm_cylinder(bm, center, radius, height, segments=20, axis="Z", rot=None,
                cap_ends=True, radius_top=None):
    """Cylinder / truncated cone appended into an existing bmesh."""
    if radius_top is None:
        radius_top = radius
    basis = {"Z": (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))),
             "Y": (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
             "X": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)))}[axis]
    u, w, n = basis
    rm = Euler(rot, "XYZ").to_matrix() if rot else Matrix.Identity(3)
    c = Vector(center)
    lo, hi = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        off = (u * math.cos(a) + w * math.sin(a))
        lo.append(bm.verts.new(c + rm @ (off * radius - n * height / 2)))
        hi.append(bm.verts.new(c + rm @ (off * radius_top + n * height / 2)))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if cap_ends:
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
    return lo, hi


def cyl_obj(name, center, radius, height, segments=20, axis="Z", rot=None,
            mat=None, smooth=True, radius_top=None, cap_ends=True):
    bm = bmesh.new()
    bm_cylinder(bm, center, radius, height, segments, axis, rot,
                cap_ends=cap_ends, radius_top=radius_top)
    obj = obj_from_bmesh(name, bm, smooth=smooth)
    if mat:
        obj.data.materials.append(mat)
    return obj


def bmesh_icosphere(bm, subdiv, radius, matrix=None):
    """bmesh.ops.create_icosphere renamed its radius argument across releases."""
    kw = {"subdivisions": subdiv}
    if matrix is not None:
        kw["matrix"] = matrix
    try:
        bmesh.ops.create_icosphere(bm, radius=radius, **kw)
    except TypeError:
        bmesh.ops.create_icosphere(bm, diameter=radius, **kw)


def sphere_obj(name, center, radius, mat=None, scale=(1, 1, 1), subdiv=3, rot=None):
    bm = bmesh.new()
    bmesh_icosphere(bm, subdiv, radius)
    rm = Euler(rot, "XYZ").to_matrix().to_4x4() if rot else Matrix.Identity(4)
    m = Matrix.Translation(center) @ rm @ Matrix.Diagonal(Vector(scale).to_4d())
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    obj = obj_from_bmesh(name, bm, smooth=True)
    if mat:
        obj.data.materials.append(mat)
    return obj


def plane_obj(name, center, size_x, size_y, mat=None, rot=None):
    bm = bmesh.new()
    sx, sy = size_x / 2, size_y / 2
    rm = Euler(rot, "XYZ").to_matrix() if rot else Matrix.Identity(3)
    c = Vector(center)
    vs = [bm.verts.new(c + rm @ Vector(p)) for p in
          ((-sx, -sy, 0), (sx, -sy, 0), (sx, sy, 0), (-sx, sy, 0))]
    bm.faces.new(vs)
    obj = obj_from_bmesh(name, bm)
    if mat:
        obj.data.materials.append(mat)
    return obj


def grid_obj(name, center, size_x, size_y, nx, ny, mat=None):
    """Subdivided plane -- needed where a displacement/bump wants real geometry."""
    bm = bmesh.new()
    verts = []
    for iy in range(ny + 1):
        row = []
        for ix in range(nx + 1):
            x = center[0] - size_x / 2 + size_x * ix / nx
            y = center[1] - size_y / 2 + size_y * iy / ny
            row.append(bm.verts.new((x, y, center[2])))
        verts.append(row)
    for iy in range(ny):
        for ix in range(nx):
            bm.faces.new((verts[iy][ix], verts[iy][ix + 1],
                          verts[iy + 1][ix + 1], verts[iy + 1][ix]))
    obj = obj_from_bmesh(name, bm)
    if mat:
        obj.data.materials.append(mat)
    return obj


# --- materials -------------------------------------------------------------

def make_mat(name, base=(0.8, 0.8, 0.8), rough=0.55, metallic=0.0, spec=0.5,
             alpha=1.0, transmission=0.0, ior=1.45, emission=None,
             emission_strength=0.0, sheen=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    for key in ("Specular", "Specular IOR Level"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = ior
    for key in ("Transmission", "Transmission Weight"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = transmission
            break
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    if emission is not None:
        for key in ("Emission", "Emission Color"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def mat_nodes(mat):
    return mat.node_tree, mat.node_tree.nodes["Principled BSDF"]


def add_noise_color(mat, col_a, col_b, scale=(1, 1, 1), noise_scale=6.0,
                    detail=6.0, distortion=0.0, ramp_lo=0.38, ramp_hi=0.62,
                    coords="Object", roughness_ramp=None):
    """Two-tone procedural colour driven by a (possibly anisotropic) noise."""
    nt, bsdf = mat_nodes(mat)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1100, 0)
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.location = (-900, 0)
    mapping.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs[coords], mapping.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.location = (-700, 0)
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = detail
    if "Distortion" in noise.inputs:
        noise.inputs["Distortion"].default_value = distortion
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-480, 0)
    ramp.color_ramp.elements[0].position = ramp_lo
    ramp.color_ramp.elements[0].color = (*col_a, 1.0)
    ramp.color_ramp.elements[1].position = ramp_hi
    ramp.color_ramp.elements[1].color = (*col_b, 1.0)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if roughness_ramp is not None:
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.location = (-480, -260)
        mr.inputs["To Min"].default_value = roughness_ramp[0]
        mr.inputs["To Max"].default_value = roughness_ramp[1]
        nt.links.new(noise.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], bsdf.inputs["Roughness"])
    return nt, noise, mapping


def add_bump(mat, source_out, strength=0.2, distance=0.02):
    nt, bsdf = mat_nodes(mat)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-260, -400)
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = distance
    nt.links.new(source_out, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return bump


# ==========================================================================
# Materials library
# ==========================================================================

MATS = {}


def build_materials():
    M = MATS

    # --- Deck planks: sun-bleached cedar. Grain streaks run along X (the
    # plank direction); a second, Y-fast noise gives each board its own tone
    # so the deck reads as boards rather than one striped sheet.
    m = make_mat("EngawaDeck", rough=0.62, spec=0.32)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.13, 5.0, 1.0)   # streak along X
    nt.links.new(tc.outputs["Object"], mapping.inputs["Vector"])
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 9.0
    grain.inputs["Detail"].default_value = 9.0
    grain.inputs["Roughness"].default_value = 0.62
    if "Distortion" in grain.inputs:
        grain.inputs["Distortion"].default_value = 1.6
    nt.links.new(mapping.outputs["Vector"], grain.inputs["Vector"])

    board_map = nt.nodes.new("ShaderNodeMapping")
    board_map.inputs["Scale"].default_value = (0.06, 6.6, 1.0)  # ~1 cell/plank
    nt.links.new(tc.outputs["Object"], board_map.inputs["Vector"])
    board = nt.nodes.new("ShaderNodeTexNoise")
    board.inputs["Scale"].default_value = 1.0
    board.inputs["Detail"].default_value = 1.0
    nt.links.new(board_map.outputs["Vector"], board.inputs["Vector"])

    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    mix.inputs["Fac"].default_value = 0.56
    nt.links.new(grain.outputs["Fac"], mix.inputs["Color1"])
    nt.links.new(board.outputs["Fac"], mix.inputs["Color2"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.26
    cr.elements[0].color = (0.200, 0.112, 0.050, 1.0)
    cr.elements[1].position = 0.78
    cr.elements[1].color = (0.610, 0.408, 0.205, 1.0)
    e = cr.elements.new(0.52)
    e.color = (0.395, 0.238, 0.113, 1.0)
    nt.links.new(mix.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    add_bump(m, grain.outputs["Fac"], strength=0.28, distance=0.008)
    M["deck"] = m

    # --- Structural timber: darker, oiled, for posts / beams / joists.
    m = make_mat("EngawaTimber", rough=0.60, spec=0.30)
    add_noise_color(m, (0.132, 0.081, 0.046), (0.300, 0.196, 0.112),
                    scale=(0.25, 0.25, 3.0), noise_scale=7.0, detail=7.0,
                    distortion=1.2, ramp_lo=0.33, ramp_hi=0.70)
    M["timber"] = m

    # --- Lattice / frame wood: mid warm brown (shoji frames, renji slats).
    m = make_mat("EngawaLattice", rough=0.55, spec=0.32)
    add_noise_color(m, (0.205, 0.128, 0.070), (0.400, 0.268, 0.150),
                    scale=(2.0, 2.0, 0.35), noise_scale=6.0, detail=6.0,
                    distortion=1.0, ramp_lo=0.34, ramp_hi=0.70)
    M["lattice"] = m

    # --- Shoji paper: thin translucent washi. Backlit sheets are the whole
    # point of shoji, so this is a translucent BSDF, not just a white diffuse.
    m = bpy.data.materials.new("EngawaShoji")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diff.inputs["Color"].default_value = (0.885, 0.870, 0.820, 1.0)
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    trans.inputs["Color"].default_value = (0.930, 0.905, 0.820, 1.0)
    mixs = nt.nodes.new("ShaderNodeMixShader")
    mixs.inputs["Fac"].default_value = 0.55
    nt.links.new(diff.outputs[0], mixs.inputs[1])
    nt.links.new(trans.outputs[0], mixs.inputs[2])
    # faint fibre texture so the paper isn't a dead flat white
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 14.0, 6.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 24.0
    nz.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.40
    rr.color_ramp.elements[0].color = (0.845, 0.828, 0.775, 1.0)
    rr.color_ramp.elements[1].position = 0.62
    rr.color_ramp.elements[1].color = (0.930, 0.915, 0.868, 1.0)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], diff.inputs["Color"])
    nt.links.new(mixs.outputs[0], out.inputs["Surface"])
    M["shoji"] = m

    # --- Plaster wall (sunaba / earthen): warm grey.
    m = make_mat("EngawaPlaster", rough=0.92, spec=0.12)
    add_noise_color(m, (0.300, 0.278, 0.248), (0.420, 0.398, 0.363),
                    scale=(1, 1, 1), noise_scale=14.0, detail=8.0,
                    ramp_lo=0.40, ramp_hi=0.62)
    M["plaster"] = m

    # --- Tatami: pale green rush, with the weave running along X.
    m = make_mat("EngawaTatami", rough=0.80, spec=0.16)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 140.0, 1.0)   # fine weave rows
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "Y"
    wv.inputs["Scale"].default_value = 1.0
    wv.inputs["Distortion"].default_value = 1.2
    nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.30
    rr.color_ramp.elements[0].color = (0.470, 0.442, 0.252, 1.0)
    rr.color_ramp.elements[1].position = 0.80
    rr.color_ramp.elements[1].color = (0.640, 0.622, 0.398, 1.0)
    nt.links.new(wv.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    add_bump(m, wv.outputs["Fac"], strength=0.35, distance=0.004)
    M["tatami"] = m

    M["tatami_edge"] = make_mat("EngawaTatamiEdge", base=(0.115, 0.098, 0.078),
                                rough=0.72, spec=0.25)

    # --- Stone/concrete pier blocks under the deck edge.
    m = make_mat("EngawaStone", rough=0.90, spec=0.18)
    add_noise_color(m, (0.180, 0.180, 0.176), (0.330, 0.330, 0.318),
                    scale=(1, 1, 1), noise_scale=5.0, detail=9.0,
                    distortion=0.8, ramp_lo=0.35, ramp_hi=0.68)
    M["stone"] = m

    # --- Water. A closed box (surface at WATER_LEVEL, bed at POND_FLOOR) so
    # Volume Absorption actually has an interior to colour: depth reads as
    # depth, not as a flat green plastic sheet. Ripples come from a bump on
    # two crossed wave textures, not from displacement -- cheaper and the
    # highlights land the same.
    m = bpy.data.materials.new("EngawaWater")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.02
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.333
    for key in ("Transmission", "Transmission Weight"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 1.0
            break
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    w1 = nt.nodes.new("ShaderNodeTexWave")
    w1.wave_type = "BANDS"
    w1.bands_direction = "X"
    w1.inputs["Scale"].default_value = 2.6
    w1.inputs["Distortion"].default_value = 13.0
    w1.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], w1.inputs["Vector"])
    w2 = nt.nodes.new("ShaderNodeTexWave")
    w2.wave_type = "BANDS"
    w2.bands_direction = "Y"
    w2.inputs["Scale"].default_value = 1.9
    w2.inputs["Distortion"].default_value = 11.0
    w2.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], w2.inputs["Vector"])
    cross = nt.nodes.new("ShaderNodeMixRGB")
    cross.inputs["Fac"].default_value = 0.5
    nt.links.new(w1.outputs["Fac"], cross.inputs["Color1"])
    nt.links.new(w2.outputs["Fac"], cross.inputs["Color2"])
    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 7.0
    n1.inputs["Detail"].default_value = 8.0
    nt.links.new(mp.outputs["Vector"], n1.inputs["Vector"])
    mixw = nt.nodes.new("ShaderNodeMixRGB")
    mixw.inputs["Fac"].default_value = 0.45
    nt.links.new(cross.outputs["Color"], mixw.inputs["Color1"])
    nt.links.new(n1.outputs["Fac"], mixw.inputs["Color2"])
    swell = nt.nodes.new("ShaderNodeTexNoise")
    swell.inputs["Scale"].default_value = 1.15
    swell.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], swell.inputs["Vector"])
    mixs2 = nt.nodes.new("ShaderNodeMixRGB")
    mixs2.inputs["Fac"].default_value = 0.42
    nt.links.new(mixw.outputs["Color"], mixs2.inputs["Color1"])
    nt.links.new(swell.outputs["Fac"], mixs2.inputs["Color2"])
    mixw = mixs2
    add_bump(m, mixw.outputs["Color"], strength=0.58, distance=0.075)
    # A transmissive BSDF is opaque to Cycles' shadow rays, so with refractive
    # caustics off the pond bed and the koi received *no* direct sunlight at
    # all and the whole pond rendered black. Swap the surface for a plain
    # Transparent BSDF on shadow rays only: light gets in (still attenuated by
    # the volume, so depth still reads as depth) while camera rays keep the
    # real refraction and the Fresnel sheen.
    lp = nt.nodes.new("ShaderNodeLightPath")
    lp.location = (-300, 520)
    shadow_pass = nt.nodes.new("ShaderNodeBsdfTransparent")
    shadow_pass.location = (100, 480)
    mix_shadow = nt.nodes.new("ShaderNodeMixShader")
    mix_shadow.location = (380, 380)
    nt.links.new(lp.outputs["Is Shadow Ray"], mix_shadow.inputs["Fac"])
    nt.links.new(bsdf.outputs["BSDF"], mix_shadow.inputs[1])
    nt.links.new(shadow_pass.outputs[0], mix_shadow.inputs[2])
    nt.links.new(mix_shadow.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.230, 0.700, 0.790, 1.0)
    vol.inputs["Density"].default_value = 0.82
    sca = nt.nodes.new("ShaderNodeVolumeScatter")
    sca.inputs["Color"].default_value = (0.420, 0.800, 0.820, 1.0)
    sca.inputs["Density"].default_value = 0.025
    addv = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(vol.outputs[0], addv.inputs[0])
    nt.links.new(sca.outputs[0], addv.inputs[1])
    nt.links.new(addv.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    M["water"] = m

    # --- Pond bed: dark silty green-brown.
    m = make_mat("EngawaPondBed", rough=0.95, spec=0.05)
    add_noise_color(m, (0.150, 0.180, 0.120), (0.320, 0.330, 0.215),
                    scale=(1, 1, 1), noise_scale=11.0, detail=8.0,
                    ramp_lo=0.35, ramp_hi=0.70)
    M["pondbed"] = m

    # --- Koi.
    m = make_mat("EngawaKoi", rough=0.28, spec=0.6)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2.2, 6.0, 6.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.interpolation = "CONSTANT"
    rr.color_ramp.elements[0].position = 0.0
    rr.color_ramp.elements[0].color = (0.930, 0.900, 0.850, 1.0)
    e = rr.color_ramp.elements.new(0.52)
    e.color = (0.900, 0.240, 0.045, 1.0)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    M["koi"] = m
    M["koi_pale"] = make_mat("EngawaKoiPale", base=(0.880, 0.845, 0.760),
                             rough=0.30, spec=0.6)
    M["koi_fin"] = make_mat("EngawaKoiFin", base=(0.900, 0.870, 0.820),
                            rough=0.35, alpha=0.65)

    # --- Foliage.
    M["leaf_bamboo"] = _leaf_material("EngawaBambooLeaf", (0.055, 0.190, 0.038),
                                      (0.145, 0.360, 0.070))
    M["leaf_bamboo_fg"] = _leaf_material("EngawaBambooLeafFG",
                                         (0.020, 0.062, 0.018),
                                         (0.070, 0.170, 0.042),
                                         translucency=0.22)
    M["leaf_far"] = _leaf_material("EngawaFarLeaf", (0.060, 0.185, 0.055),
                                   (0.190, 0.420, 0.105))
    M["leaf_bonsai"] = _leaf_material("EngawaBonsaiLeaf", (0.035, 0.130, 0.030),
                                      (0.105, 0.270, 0.055))
    M["lilypad"] = _leaf_material("EngawaLilyPad", (0.072, 0.170, 0.072),
                                  (0.178, 0.330, 0.115), translucency=0.30)
    M["bamboo_culm"] = make_mat("EngawaBambooCulm", base=(0.330, 0.400, 0.130),
                                rough=0.42, spec=0.4)
    M["stem"] = make_mat("EngawaStem", base=(0.150, 0.190, 0.065), rough=0.65)
    M["bark"] = make_mat("EngawaBark", base=(0.075, 0.058, 0.042), rough=0.85)

    # --- Props.
    M["glass"] = make_mat("EngawaGlass", base=(0.96, 0.99, 0.97), rough=0.03,
                          transmission=1.0, ior=1.45)
    M["glass_blue"] = make_mat("EngawaGlassBlue", base=(0.62, 0.86, 0.95),
                               rough=0.05, transmission=1.0, ior=1.46)
    M["glass_pink"] = make_mat("EngawaGlassPink", base=(0.96, 0.70, 0.78),
                               rough=0.05, transmission=1.0, ior=1.46)
    M["tea"] = make_mat("EngawaTea", base=(0.480, 0.140, 0.030), rough=0.06,
                        transmission=0.92, ior=1.34)
    M["metal"] = make_mat("EngawaMetal", base=(0.760, 0.775, 0.790),
                          rough=0.24, metallic=1.0)
    M["metal_dark"] = make_mat("EngawaMetalDark", base=(0.320, 0.330, 0.340),
                               rough=0.38, metallic=1.0)
    M["fan_body"] = make_mat("EngawaFanBody", base=(0.330, 0.720, 0.660),
                             rough=0.30, spec=0.6)
    M["fan_blade"] = make_mat("EngawaFanBlade", base=(0.860, 0.895, 0.885),
                              rough=0.22, spec=0.6)
    M["cord"] = make_mat("EngawaCord", base=(0.870, 0.870, 0.860), rough=0.55)
    M["watermelon"] = _watermelon_material()
    M["melon_rind"] = make_mat("EngawaMelonRind", base=(0.210, 0.400, 0.120),
                               rough=0.35)
    M["oke"] = make_mat("EngawaOke", rough=0.58, spec=0.3)
    add_noise_color(M["oke"], (0.360, 0.240, 0.128), (0.620, 0.462, 0.272),
                    scale=(3.0, 3.0, 0.25), noise_scale=8.0, detail=7.0,
                    distortion=1.4, ramp_lo=0.32, ramp_hi=0.72)
    M["apple"] = make_mat("EngawaApple", base=(0.720, 0.140, 0.090), rough=0.22,
                          spec=0.6)
    M["grape"] = make_mat("EngawaGrape", base=(0.470, 0.600, 0.150), rough=0.20,
                          spec=0.6)
    M["plate"] = make_mat("EngawaPlate", base=(0.050, 0.048, 0.046), rough=0.25,
                          spec=0.6)
    M["ceramic"] = make_mat("EngawaCeramic", base=(0.480, 0.465, 0.430),
                            rough=0.32, spec=0.5)
    M["ceramic_dark"] = make_mat("EngawaCeramicDark", base=(0.120, 0.128, 0.132),
                                 rough=0.30, spec=0.55)
    M["brass"] = make_mat("EngawaBrass", base=(0.680, 0.520, 0.210), rough=0.28,
                          metallic=1.0)
    M["paper"] = make_mat("EngawaPaper", base=(0.900, 0.880, 0.830), rough=0.75,
                          spec=0.15)
    M["wrapper"] = make_mat("EngawaWrapper", base=(0.820, 0.865, 0.900),
                            rough=0.28, spec=0.7)
    M["soil"] = make_mat("EngawaSoil", base=(0.055, 0.042, 0.032), rough=0.95)
    M["lotus"] = make_mat("EngawaLotus", base=(0.940, 0.800, 0.830), rough=0.55,
                          spec=0.25)
    M["lotus_core"] = make_mat("EngawaLotusCore", base=(0.880, 0.760, 0.230),
                               rough=0.6)
    M["cushion"] = make_mat("EngawaCushion", base=(0.520, 0.440, 0.220),
                            rough=0.85, spec=0.2)
    M["rooftile"] = make_mat("EngawaRoofTile", base=(0.052, 0.058, 0.068),
                             rough=0.48, spec=0.45)
    m = make_mat("EngawaGrass", rough=0.88, spec=0.15)
    add_noise_color(m, (0.055, 0.115, 0.030), (0.155, 0.265, 0.070),
                    scale=(1, 1, 1), noise_scale=22.0, detail=9.0,
                    distortion=1.5, ramp_lo=0.36, ramp_hi=0.66)
    M["grass"] = m
    return M


def _leaf_material(name, dark, light, translucency=0.40):
    """Leaves need to glow when backlit or they read as flat green cut-outs."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.2, 1.2, 1.2)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.6
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.34
    rr.color_ramp.elements[0].color = (*dark, 1.0)
    rr.color_ramp.elements[1].position = 0.70
    rr.color_ramp.elements[1].color = (*light, 1.0)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Fac"])

    diff = nt.nodes.new("ShaderNodeBsdfPrincipled")
    diff.inputs["Roughness"].default_value = 0.38
    for key in ("Specular", "Specular IOR Level"):
        if key in diff.inputs:
            diff.inputs[key].default_value = 0.45
            break
    nt.links.new(rr.outputs["Color"], diff.inputs["Base Color"])
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(rr.outputs["Color"], trans.inputs["Color"])
    mixs = nt.nodes.new("ShaderNodeMixShader")
    mixs.inputs["Fac"].default_value = translucency
    nt.links.new(diff.outputs[0], mixs.inputs[1])
    nt.links.new(trans.outputs[0], mixs.inputs[2])
    nt.links.new(mixs.outputs[0], out.inputs["Surface"])
    return m


def _watermelon_material():
    m = make_mat("EngawaWatermelon", rough=0.30, spec=0.5)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (9.0, 9.0, 0.55)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "X"
    wv.inputs["Scale"].default_value = 1.0
    wv.inputs["Distortion"].default_value = 3.2
    wv.inputs["Detail"].default_value = 2.0
    nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.interpolation = "CONSTANT"
    rr.color_ramp.elements[0].position = 0.0
    rr.color_ramp.elements[0].color = (0.330, 0.560, 0.150, 1.0)
    e = rr.color_ramp.elements.new(0.46)
    e.color = (0.055, 0.185, 0.045, 1.0)
    nt.links.new(wv.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    return m


# ==========================================================================
# The deck
# ==========================================================================

def build_deck():
    """Engawa floor. Separate boards with real gaps between them, split into
    butt-jointed runs, each board nudged a few tenths of a millimetre in
    height and shifted in the grain texture -- otherwise a procedural wood
    shader across one big slab reads as painted stripes, not planks."""
    mat = MATS["deck"]
    plank_w, gap = 0.156, 0.007
    pitch = plank_w + gap
    span = DECK_BACK - DECK_FRONT
    rows = int(round(span / pitch))
    pitch = span / rows
    plank_w = pitch - gap

    bm = bmesh.new()
    for r in range(rows):
        y = DECK_FRONT + pitch * (r + 0.5)
        # Every third board sits dead on the contract plane; the rest drop a
        # few tenths of a millimetre so the deck is not a machined slab. No
        # board is ever ABOVE Z = 0.
        drop = 0.0 if r % 3 == 0 else RNG.uniform(0.00015, 0.0006)
        # 2-3 butt-jointed runs per row, joints staggered row to row
        n_seg = RNG.choice((2, 2, 3))
        cuts = sorted(RNG.uniform(-DECK_X * 0.55, DECK_X * 0.55)
                      for _ in range(n_seg - 1))
        edges = [-DECK_X] + cuts + [DECK_X]
        for i in range(len(edges) - 1):
            x0, x1 = edges[i] + (0.004 if i else 0.0), edges[i + 1] - 0.004
            bm_box(bm, ((x0 + x1) / 2, y, DECK_TOP - drop - DECK_THICK / 2),
                   (x1 - x0, plank_w, DECK_THICK))
    deck = obj_from_bmesh("Engawa_Deck_Planks", bm)
    deck.data.materials.append(mat)

    # Nose board capping the water edge, plus joists and a back ledger.
    bm = bmesh.new()
    bm_box(bm, (0, DECK_FRONT - 0.030, -DECK_THICK / 2 - 0.018),
           (DECK_X * 2, 0.060, DECK_THICK + 0.036))          # front fascia
    for x in [-4.0, -2.6, -1.25, 0.15, 1.55, 2.9, 4.1]:
        bm_box(bm, (x, (DECK_FRONT + DECK_BACK) / 2 + 0.02, -0.115),
               (0.085, span - 0.02, 0.10))                   # joists
    bm_box(bm, (0, DECK_BACK - 0.06, -0.115), (DECK_X * 2, 0.12, 0.10))
    bm_box(bm, (0, DECK_FRONT + 0.06, -0.115), (DECK_X * 2, 0.12, 0.10))
    frame = obj_from_bmesh("Engawa_Deck_Frame", bm)
    frame.data.materials.append(MATS["timber"])

    # Stone piers standing in the pond, carrying the front beam.
    bm = bmesh.new()
    for x in (-3.45, -1.55, 0.55, 2.65, 4.05):
        h = RNG.uniform(1.76, 1.84)
        top = -0.175
        bm_box(bm, (x, DECK_FRONT - 0.01, top - h / 2), (0.34, 0.30, h))
        bm_box(bm, (x, DECK_FRONT - 0.01, top - h + 0.055), (0.42, 0.38, 0.11))
    piers = obj_from_bmesh("Engawa_Deck_Piers", bm)
    piers.data.materials.append(MATS["stone"])
    return deck


# ==========================================================================
# The house: posts, beams, shoji, renji window, tatami, eave
# ==========================================================================

def _shoji_panel(bm_frame, bm_paper, x0, x1, z0, z1, y, cols=3, rows=5,
                 depth=0.030):
    """One sliding door: a stile-and-rail frame with a fine kumiko lattice,
    with the paper sheet on the far (interior) face."""
    stile = 0.042
    rail = 0.046
    lat = 0.014
    def fb(cx, cz, sx, sz):
        bm_box(bm_frame, (cx, y, cz), (sx, depth, sz))
    fb(x0 + stile / 2, (z0 + z1) / 2, stile, z1 - z0)
    fb(x1 - stile / 2, (z0 + z1) / 2, stile, z1 - z0)
    fb((x0 + x1) / 2, z0 + rail / 2, x1 - x0, rail)
    fb((x0 + x1) / 2, z1 - rail / 2, x1 - x0, rail)
    ix0, ix1 = x0 + stile, x1 - stile
    iz0, iz1 = z0 + rail, z1 - rail
    for c in range(1, cols):
        fb(ix0 + (ix1 - ix0) * c / cols, (iz0 + iz1) / 2, lat, iz1 - iz0)
    for r in range(1, rows):
        fb((ix0 + ix1) / 2, iz0 + (iz1 - iz0) * r / rows, ix1 - ix0, lat)
    # paper, set just behind the lattice
    bm_box(bm_paper, ((x0 + x1) / 2, y + depth / 2 + 0.004, (iz0 + iz1) / 2),
           (ix1 - ix0 + 0.02, 0.004, iz1 - iz0 + 0.02))


def build_house():
    head_z = 2.22            # kamoi (head track) underside
    sill_top = 0.062
    objs = []

    # --- posts, head beam, transom band --------------------------------
    bm = bmesh.new()
    post_x = [-4.24, -2.16, -0.08, 2.00, 4.08]
    for x in post_x:
        bm_box(bm, (x, WALL_Y, (0 + EAVE_Z) / 2), (POST_W, POST_W * 1.15, EAVE_Z))
    bm_box(bm, (0, WALL_Y, head_z + 0.075), (DECK_X * 2 + 0.4, 0.155, 0.15))
    bm_box(bm, (0, WALL_Y, EAVE_Z - 0.10), (DECK_X * 2 + 0.4, 0.175, 0.20))
    # shikii (sill) the doors run in
    bm_box(bm, (0, WALL_Y, sill_top / 2), (DECK_X * 2 + 0.4, 0.145, sill_top))
    structure = obj_from_bmesh("Engawa_House_Structure", bm)
    structure.data.materials.append(MATS["timber"])
    objs.append(structure)

    # --- transom (ranma) plaster infill above the head beam -------------
    bm = bmesh.new()
    bm_box(bm, (0, WALL_Y, (head_z + 0.15 + EAVE_Z - 0.20) / 2 + 0.0),
           (DECK_X * 2 + 0.4, 0.075, (EAVE_Z - 0.20) - (head_z + 0.15)))
    ranma = obj_from_bmesh("Engawa_House_Ranma", bm)
    ranma.data.materials.append(MATS["plaster"])
    objs.append(ranma)

    # --- sliding doors -------------------------------------------------
    # Left bay closed (two panels), the next bay half open, the two bays in
    # front of the camera slid away so the room is visible.
    bmf, bmp = bmesh.new(), bmesh.new()
    z0, z1 = sill_top, head_z
    bay_a = (post_x[0] + POST_W / 2, post_x[1] - POST_W / 2)
    mid_a = (bay_a[0] + bay_a[1]) / 2
    _shoji_panel(bmf, bmp, bay_a[0], mid_a + 0.02, z0, z1, WALL_Y - 0.035)
    _shoji_panel(bmf, bmp, mid_a - 0.02, bay_a[1], z0, z1, WALL_Y + 0.035)
    bay_b = (post_x[1] + POST_W / 2, post_x[2] - POST_W / 2)
    _shoji_panel(bmf, bmp, bay_b[0], bay_b[0] + (bay_b[1] - bay_b[0]) * 0.56,
                 z0, z1, WALL_Y - 0.035)
    # a single panel parked at the far right end
    bay_d = (post_x[3] + POST_W / 2, post_x[4] - POST_W / 2)
    _shoji_panel(bmf, bmp, bay_d[1] - (bay_d[1] - bay_d[0]) * 0.52, bay_d[1],
                 z0, z1, WALL_Y - 0.035)
    frames = obj_from_bmesh("Engawa_Shoji_Frames", bmf)
    frames.data.materials.append(MATS["lattice"])
    paper = obj_from_bmesh("Engawa_Shoji_Paper", bmp)
    paper.data.materials.append(MATS["shoji"])
    objs += [frames, paper]

    # --- tatami --------------------------------------------------------
    bm, bme = bmesh.new(), bmesh.new()
    ty0, ty1 = WALL_Y + 0.075, BACK_WALL_Y - 0.06
    tx0, tx1 = -4.30, 4.15
    mat_w, mat_l = 0.92, 1.84
    ny = max(1, int(round((ty1 - ty0) / mat_w)))
    mw = (ty1 - ty0) / ny
    nx = max(1, int(round((tx1 - tx0) / mat_l)))
    ml = (tx1 - tx0) / nx
    for iy in range(ny):
        for ix in range(nx):
            cx = tx0 + ml * (ix + 0.5)
            cy = ty0 + mw * (iy + 0.5)
            bm_box(bm, (cx, cy, TATAMI_TOP / 2), (ml - 0.012, mw - 0.012, TATAMI_TOP))
            for s in (-1, 1):
                bm_box(bme, (cx, cy + s * (mw / 2 - 0.026), TATAMI_TOP / 2 + 0.001),
                       (ml - 0.012, 0.046, TATAMI_TOP + 0.002))
    tat = obj_from_bmesh("Engawa_Tatami", bm)
    tat.data.materials.append(MATS["tatami"])
    edge = obj_from_bmesh("Engawa_Tatami_Edges", bme)
    edge.data.materials.append(MATS["tatami_edge"])
    objs += [tat, edge]

    # --- back wall with the renji window --------------------------------
    win = (0.30, 2.75, 0.62, 1.50)     # x0, x1, z0, z1
    wx0, wx1 = -4.35, 4.20
    wt = 0.11
    bm = bmesh.new()
    bm_box(bm, ((wx0 + win[0]) / 2, BACK_WALL_Y, EAVE_Z / 2),
           (win[0] - wx0, wt, EAVE_Z))
    bm_box(bm, ((win[1] + wx1) / 2, BACK_WALL_Y, EAVE_Z / 2),
           (wx1 - win[1], wt, EAVE_Z))
    bm_box(bm, ((win[0] + win[1]) / 2, BACK_WALL_Y, win[2] / 2),
           (win[1] - win[0], wt, win[2]))
    bm_box(bm, ((win[0] + win[1]) / 2, BACK_WALL_Y, (win[3] + EAVE_Z) / 2),
           (win[1] - win[0], wt, EAVE_Z - win[3]))
    wall = obj_from_bmesh("Engawa_Back_Wall", bm)
    wall.data.materials.append(MATS["plaster"])
    objs.append(wall)

    # left return wall so the frame edge is closed off
    bm = bmesh.new()
    bm_box(bm, (-4.32, (WALL_Y + BACK_WALL_Y) / 2, EAVE_Z / 2),
           (wt, BACK_WALL_Y - WALL_Y, EAVE_Z))
    bm_box(bm, (4.18, (WALL_Y + BACK_WALL_Y) / 2, EAVE_Z / 2),
           (wt, BACK_WALL_Y - WALL_Y, EAVE_Z))
    side = obj_from_bmesh("Engawa_Side_Walls", bm)
    side.data.materials.append(MATS["plaster"])
    objs.append(side)

    # renji: vertical slats in a wooden surround
    bm = bmesh.new()
    for z in (win[2], win[3]):
        bm_box(bm, ((win[0] + win[1]) / 2, BACK_WALL_Y, z),
               (win[1] - win[0] + 0.09, wt + 0.05, 0.075))
    for x in (win[0], win[1]):
        bm_box(bm, (x, BACK_WALL_Y, (win[2] + win[3]) / 2),
               (0.075, wt + 0.05, win[3] - win[2] + 0.09))
    n_slat = 26
    for i in range(n_slat):
        x = win[0] + (win[1] - win[0]) * (i + 0.5) / n_slat
        bm_box(bm, (x, BACK_WALL_Y - 0.005, (win[2] + win[3]) / 2),
               (0.030, 0.055, win[3] - win[2]))
    # one horizontal mid rail
    bm_box(bm, ((win[0] + win[1]) / 2, BACK_WALL_Y - 0.005,
                win[2] + (win[3] - win[2]) * 0.62),
           (win[1] - win[0], 0.058, 0.038))
    renji = obj_from_bmesh("Engawa_Renji_Window", bm)
    renji.data.materials.append(MATS["lattice"])
    objs.append(renji)

    # --- eave / soffit over the deck ------------------------------------
    bm = bmesh.new()
    depth = WALL_Y - EAVE_FRONT
    bm_box(bm, (0, (EAVE_FRONT + WALL_Y) / 2, EAVE_Z + 0.045),
           (DECK_X * 2 + 0.6, depth, 0.09))
    for x in [-3.6, -1.8, 0.0, 1.8, 3.6]:
        bm_box(bm, (x, (EAVE_FRONT + WALL_Y) / 2, EAVE_Z - 0.035),
               (0.085, depth, 0.07))                          # rafters
    bm_box(bm, (0, EAVE_FRONT + 0.045, EAVE_Z - 0.060),
           (DECK_X * 2 + 0.6, 0.09, 0.30))                    # fascia
    eave = obj_from_bmesh("Engawa_Eave", bm)
    eave.data.materials.append(MATS["timber"])
    objs.append(eave)

    # --- tiled roof sloping back from the eave to the ridge --------------
    # Mostly for the establishing shot -- from the hero camera only its
    # underside shows -- but without it the wide render reads as a film set
    # with no building on it.
    front_z = EAVE_Z + 0.10
    run = ROOF_RIDGE_Y - EAVE_FRONT
    rise = ROOF_RIDGE_Z - front_z
    pitch = math.atan2(rise, run)
    bm = bmesh.new()
    bm_box(bm, (0, (EAVE_FRONT + ROOF_RIDGE_Y) / 2, (front_z + ROOF_RIDGE_Z) / 2),
           (DECK_X * 2 + 0.9, math.hypot(run, rise), 0.12), rot=(pitch, 0, 0))
    bm_box(bm, (0, ROOF_RIDGE_Y, ROOF_RIDGE_Z + 0.07),
           (DECK_X * 2 + 0.9, 0.34, 0.16))
    # a row of batten ridges so the slope is not a bare ramp
    for i in range(11):
        x = -DECK_X - 0.35 + (DECK_X * 2 + 0.7) * i / 10
        bm_box(bm, (x, (EAVE_FRONT + ROOF_RIDGE_Y) / 2,
                    (front_z + ROOF_RIDGE_Z) / 2 + 0.055),
               (0.085, math.hypot(run, rise) - 0.05, 0.09), rot=(pitch, 0, 0))
    bm_box(bm, (0, EAVE_FRONT - 0.05, front_z - 0.04),
           (DECK_X * 2 + 0.9, 0.16, 0.13))           # eave tile course
    roof = obj_from_bmesh("Engawa_Roof", bm)
    roof.data.materials.append(MATS["rooftile"])
    objs.append(roof)
    return objs


# ==========================================================================
# Foliage primitives
# ==========================================================================

def add_leaf(bm, base, tip_dir, side_dir, length, width, droop=0.30, fold=0.22):
    """A lanceolate leaf: pointed tip, widest a third of the way up, folded
    along the midrib and drooping at the tip. Six real quads, not a billboard
    -- flat cards are what make procedural foliage read as green blobs."""
    t = Vector(tip_dir).normalized()
    s = Vector(side_dir)
    s = (s - t * s.dot(t))
    if s.length < 1e-6:
        s = t.cross(Vector((0, 0, 1)))
    s.normalize()
    n = t.cross(s).normalized()
    b = Vector(base)
    profile = [(0.00, 0.10), (0.16, 0.62), (0.38, 1.00), (0.66, 0.76),
               (0.86, 0.40), (1.00, 0.0)]
    mid, left, right = [], [], []
    for (u, w) in profile:
        sag = -droop * length * (u ** 2)
        p = b + t * (length * u) + n * sag
        mid.append(p)
        off = s * (width * w / 2)
        lift = n * (fold * width * w)
        left.append(p + off + lift)
        right.append(p - off + lift)
    vm = [bm.verts.new(p) for p in mid]
    vl = [bm.verts.new(p) for p in left]
    vr = [bm.verts.new(p) for p in right]
    for i in range(len(profile) - 1):
        bm.faces.new((vm[i], vl[i], vl[i + 1], vm[i + 1]))
        bm.faces.new((vm[i], vm[i + 1], vr[i + 1], vr[i]))


def add_twig(bm_leaf, bm_stem, start, direction, length, n_leaves,
             leaf_len, leaf_w, rng, spread=0.55, thickness=0.006):
    """A short stem with leaves alternating left/right along it."""
    d = Vector(direction).normalized()
    end = Vector(start) + d * length
    bm_cylinder(bm_stem, (Vector(start) + end) / 2, thickness, length,
                segments=5, axis="Z",
                rot=d.to_track_quat("Z", "Y").to_euler())
    up = Vector((0, 0, 1))
    side = d.cross(up)
    if side.length < 1e-5:
        side = Vector((1, 0, 0))
    side.normalize()
    for i in range(n_leaves):
        u = 0.18 + 0.82 * (i / max(1, n_leaves - 1))
        base = Vector(start) + d * (length * u)
        sgn = 1 if i % 2 == 0 else -1
        ang = rng.uniform(0.45, 0.95) * spread * sgn
        axis = d.cross(side).normalized()
        rot = Matrix.Rotation(ang, 3, axis) @ Matrix.Rotation(
            rng.uniform(-0.35, 0.35), 3, side)
        ldir = rot @ d
        ll = leaf_len * rng.uniform(0.72, 1.15)
        add_leaf(bm_leaf, base, ldir, side, ll, leaf_w * rng.uniform(0.8, 1.2),
                 droop=rng.uniform(0.18, 0.42))


# ==========================================================================
# Bamboo framing
# ==========================================================================

def build_bamboo():
    bm_leaf, bm_stem, bm_culm = bmesh.new(), bmesh.new(), bmesh.new()
    # Foreground framing greenery is kept in its own mesh (see below).
    bm_fleaf, bm_fstem, bm_fculm = bmesh.new(), bmesh.new(), bmesh.new()
    _culm_default, _leaf_default, _stem_default = bm_culm, bm_leaf, bm_stem
    rng = random.Random(77)

    def culm(base, top, r0, r1, nodes=6, tgt=None):
        bm_culm = tgt if tgt is not None else _culm_default
        b, t = Vector(base), Vector(top)
        d = t - b
        for i in range(nodes):
            a, bq = i / nodes, (i + 1) / nodes
            p0, p1 = b + d * a, b + d * bq
            rr = r0 + (r1 - r0) * a
            bm_cylinder(bm_culm, (p0 + p1) / 2, rr, (p1 - p0).length,
                        segments=10, axis="Z",
                        rot=d.to_track_quat("Z", "Y").to_euler())
            bm_cylinder(bm_culm, p1, rr * 1.16, 0.016, segments=10, axis="Z",
                        rot=d.to_track_quat("Z", "Y").to_euler())

    def branchy(origin, main_dir, spread_dir, n_twigs, scale, leaf_len=0.115):
        o = Vector(origin)
        md = Vector(main_dir).normalized()
        sd = Vector(spread_dir).normalized()
        for i in range(n_twigs):
            u = i / max(1, n_twigs - 1)
            base = o + md * (scale * 0.85 * u)
            d = (md * rng.uniform(0.25, 0.7)
                 + sd * rng.uniform(-1.0, 1.0)
                 + Vector((0, 0, 1)) * rng.uniform(-0.7, 0.25))
            add_twig(bm_leaf, bm_stem, base, d, scale * rng.uniform(0.18, 0.34),
                     rng.randint(6, 10), leaf_len, 0.030, rng)

    # Left clump. The culm itself stands well off to the side; what has to
    # land in the top-left corner of the hero frame is the foliage, which
    # means branches reaching in to roughly x=-1.7, y=-1.1, z=3.0.
    culm((-2.62, -1.62, -1.9), (-2.26, -1.38, 3.95), 0.052, 0.036)
    for (o, d, sp, n, sc) in [((-2.28, -1.40, 3.45), (0.95, 0.15, -0.10), (0.15, -0.98, 0.1), 12, 0.95),
                              ((-2.26, -1.38, 3.00), (0.90, 0.20, 0.05), (0.25, -0.94, 0.2), 11, 0.85),
                              ((-2.32, -1.42, 2.45), (0.85, 0.10, 0.15), (0.30, -0.90, 0.0), 8, 0.70)]:
        branchy(o, d, sp, n, sc, leaf_len=0.150)

    # Right clump, mirrored, a little lower so the two do not read as a pair.
    culm((3.18, -1.92, -1.9), (2.82, -1.62, 3.85), 0.048, 0.032)
    for (o, d, sp, n, sc) in [((2.82, -1.62, 3.35), (-0.95, 0.12, -0.08), (0.10, 0.98, 0.1), 12, 0.92),
                              ((2.84, -1.64, 2.85), (-0.90, 0.18, 0.06), (0.20, 0.95, 0.2), 10, 0.84),
                              ((2.88, -1.68, 2.30), (-0.85, 0.10, 0.14), (0.25, 0.92, 0.0), 8, 0.68)]:
        branchy(o, d, sp, n, sc, leaf_len=0.145)

    # Low branch drooping over the water on the right, as in the reference.
    culm((2.95, -2.95, -1.9), (2.70, -2.70, 1.55), 0.032, 0.023)
    branchy((2.71, -2.72, 1.25), (-0.88, 0.28, -0.20), (0.25, 0.80, 0.2), 9, 0.95,
            leaf_len=0.125)
    branchy((2.75, -2.76, 0.70), (-0.82, 0.20, -0.26), (0.30, 0.85, 0.1), 6, 0.78,
            leaf_len=0.115)

    # --- the two branches that actually frame the shot -------------------
    # Everything above is the bamboo as a plant; these two are the bamboo as
    # composition. Each arcs out from a culm and hangs its foliage into a top
    # corner of the hero frame, just in front of the eave fascia -- the dark
    # leafy intrusions the reference uses to close off the top of the picture.
    def arch(start, end, sag, r0, r1, n_twigs, leaf_len, tw_scale, seed_dir,
             tgt=None, t0=0.10):
        bm_culm, bm_leaf, bm_stem = (tgt if tgt is not None
                                     else (_culm_default, _leaf_default,
                                           _stem_default))
        r0, r1 = r0 * 0.55, r1 * 0.62
        a, b = Vector(start), Vector(end)
        ctrl = (a + b) / 2 + Vector((0, 0, sag))
        pts, radii = [], []
        n = 9
        for i in range(n + 1):
            t = i / n
            pts.append((1 - t) ** 2 * a + 2 * (1 - t) * t * ctrl + t ** 2 * b)
            radii.append(((r0 + (r1 - r0) * t),) * 2)
        loft_tube(bm_culm, pts, radii, segments=7)
        sd = Vector(seed_dir).normalized()
        n_twigs = int(n_twigs * 2.2)
        for i in range(n_twigs):
            t = t0 + (1.0 - t0) * (i / max(1, n_twigs - 1))
            base = ((1 - t) ** 2 * a + 2 * (1 - t) * t * ctrl + t ** 2 * b)
            base = base + Vector((rng.uniform(-0.10, 0.10),
                                  rng.uniform(-0.10, 0.10),
                                  rng.uniform(-0.05, 0.05)))
            for _ in range(2):
                d = (sd * rng.uniform(0.5, 1.2)
                     + Vector((rng.uniform(-0.5, 0.5), rng.uniform(-0.6, 0.4),
                               rng.uniform(-0.55, 0.05))))
                add_twig(bm_leaf, bm_stem, base, d,
                         tw_scale * rng.uniform(0.55, 1.15),
                         rng.randint(7, 11), leaf_len, 0.032, rng,
                         thickness=0.006)

    arch((-2.25, -1.38, 4.05), (-0.22, -1.16, 3.26), 0.12, 0.028, 0.013,
         15, 0.155, 0.30, (1.0, 0.15, -0.10))
    arch((-2.27, -1.42, 3.55), (-0.88, -1.28, 3.02), 0.10, 0.024, 0.012,
         13, 0.150, 0.28, (1.0, 0.10, -0.12))
    arch((-2.31, -1.46, 2.95), (-1.55, -1.36, 2.72), 0.07, 0.021, 0.011,
         9, 0.140, 0.24, (1.0, 0.0, -0.15))
    arch((-2.24, -1.34, 4.32), (-0.55, -1.02, 3.55), 0.11, 0.026, 0.013,
         14, 0.155, 0.30, (1.0, 0.20, -0.12))
    arch((2.80, -1.66, 4.00), (1.00, -1.12, 3.22), 0.12, 0.027, 0.013,
         15, 0.150, 0.30, (-1.0, 0.15, -0.10))
    arch((2.82, -1.70, 3.48), (1.72, -1.28, 3.02), 0.09, 0.023, 0.012,
         12, 0.145, 0.28, (-1.0, 0.10, -0.12))

    # --- foreground framing for the low shipping camera ------------------
    # The compose-shot camera sits at z=1.15 and its top edge only reaches
    # z ~= 1.28 out over the water, so the tall canopy above is far overhead
    # and out of shot. These two slim canes stand just outside the frame on
    # either side and droop their foliage down to z ~= 1.05-1.30 at y ~= -1.25,
    # which is where that camera's top corners actually are.
    FG = (bm_fculm, bm_fleaf, bm_fstem)
    culm((1.98, -1.46, -1.9), (1.88, -1.32, 2.55), 0.030, 0.021, nodes=5,
         tgt=bm_fculm)
    arch((1.86, -1.30, 2.28), (0.74, -1.24, 1.22), 0.09, 0.022, 0.011,
         16, 0.100, 0.34, (-1.0, 0.05, -0.25), tgt=FG, t0=0.56)
    arch((1.88, -1.36, 1.84), (1.02, -1.30, 1.08), 0.05, 0.019, 0.010,
         11, 0.092, 0.28, (-1.0, 0.05, -0.30), tgt=FG, t0=0.58)
    culm((-1.48, -1.62, -1.9), (-1.34, -1.48, 2.35), 0.028, 0.020, nodes=5,
         tgt=bm_fculm)
    arch((-1.32, -1.46, 2.08), (-0.36, -1.28, 1.24), 0.08, 0.020, 0.010,
         15, 0.098, 0.32, (1.0, 0.05, -0.25), tgt=FG, t0=0.56)
    arch((-1.34, -1.52, 1.70), (-0.62, -1.36, 1.06), 0.05, 0.018, 0.010,
         10, 0.090, 0.26, (1.0, 0.05, -0.30), tgt=FG, t0=0.58)

    for (bx, by, z0, z1, sgn) in [(-2.36, -1.46, 0.45, 3.90, 1.0),
                                  (2.92, -1.74, 0.40, 3.80, -1.0),
                                  (2.80, -2.80, 0.10, 1.45, -1.0)]:
        for k in range(16):
            u = k / 15.0
            base = Vector((bx + sgn * 0.02, by, z0 + (z1 - z0) * u))
            for _ in range(3):
                d = Vector((sgn * rng.uniform(0.5, 1.2), rng.uniform(-0.9, 0.6),
                            rng.uniform(-0.55, 0.20)))
                add_twig(bm_leaf, bm_stem, base, d, rng.uniform(0.18, 0.36),
                         rng.randint(6, 10), 0.135, 0.030, rng, thickness=0.005)

    leaves = obj_from_bmesh("Engawa_Bamboo_Leaves", bm_leaf)
    leaves.data.materials.append(MATS["leaf_bamboo"])
    stems = obj_from_bmesh("Engawa_Bamboo_Stems", bm_stem)
    stems.data.materials.append(MATS["stem"])
    culms = obj_from_bmesh("Engawa_Bamboo_Culms", bm_culm, smooth=True)
    culms.data.materials.append(MATS["bamboo_culm"])

    # The two low canes exist purely to close off the top corners of the
    # shipping camera, a metre and a half from the lens. Left casting, their
    # shadows fall straight across the middle of the deck -- i.e. across the
    # character -- so this group is excluded from shadow rays. The overhead
    # canopy and the gobo still supply all the dapple.
    fg_leaves = obj_from_bmesh("Engawa_Bamboo_FG_Leaves", bm_fleaf)
    fg_leaves.data.materials.append(MATS["leaf_bamboo_fg"])
    fg_stems = obj_from_bmesh("Engawa_Bamboo_FG_Stems", bm_fstem)
    fg_stems.data.materials.append(MATS["stem"])
    fg_culms = obj_from_bmesh("Engawa_Bamboo_FG_Culms", bm_fculm, smooth=True)
    fg_culms.data.materials.append(MATS["bamboo_culm"])
    for o in (fg_leaves, fg_stems, fg_culms):
        o.visible_shadow = False
    return [leaves, stems, culms, fg_leaves, fg_stems, fg_culms]


def build_garden_beyond():
    """Green mass outside the renji window -- what the slats are looking at."""
    bm_leaf, bm_stem = bmesh.new(), bmesh.new()
    rng = random.Random(311)
    for cx, cy, cz, sc in [(0.6, 4.90, 1.15, 1.0), (1.7, 5.10, 1.40, 1.1),
                           (2.6, 4.85, 0.95, 0.9), (1.2, 4.60, 0.65, 0.8),
                           (2.2, 5.35, 1.70, 1.0)]:
        for _ in range(14):
            base = Vector((cx + rng.uniform(-0.5, 0.5), cy + rng.uniform(-0.4, 0.4),
                           cz + rng.uniform(-0.6, 0.6)))
            d = Vector((rng.uniform(-1, 1), rng.uniform(-1, -0.2),
                        rng.uniform(-0.6, 0.6)))
            add_twig(bm_leaf, bm_stem, base, d, 0.30 * sc, rng.randint(4, 7),
                     0.10 * sc, 0.048 * sc, rng, thickness=0.005)
    leaves = obj_from_bmesh("Engawa_Garden_Leaves", bm_leaf)
    leaves.data.materials.append(MATS["leaf_far"])
    stems = obj_from_bmesh("Engawa_Garden_Stems", bm_stem)
    stems.data.materials.append(MATS["stem"])
    # a soft green wall far behind so gaps read as depth, not sky holes
    back = plane_obj("Engawa_Garden_Backdrop", (1.5, 6.4, 1.10), 10.0, 3.2,
                     mat=MATS["leaf_far"], rot=(math.pi / 2, 0, 0))
    return [leaves, stems, back]


# ==========================================================================
# Lofted tube -- used for fish, cat body, cat tail, tree trunks
# ==========================================================================

def loft_tube(bm, pts, radii, segments=12, cap_start=True, cap_end=True,
              up_ref=Vector((0, 0, 1))):
    """Sweep an ellipse of varying (side, up) radius along a polyline."""
    pts = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        prev = pts[max(0, i - 1)]
        nxt = pts[min(len(pts) - 1, i + 1)]
        tan = (nxt - prev)
        if tan.length < 1e-8:
            tan = Vector((1, 0, 0))
        tan.normalize()
        side = tan.cross(up_ref)
        if side.length < 1e-6:
            side = tan.cross(Vector((0, 1, 0)))
        side.normalize()
        upv = side.cross(tan).normalized()
        rs, ru = radii[i]
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            ring.append(bm.verts.new(p + side * (math.cos(a) * rs)
                                     + upv * (math.sin(a) * ru)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(segments):
            t = (s + 1) % segments
            bm.faces.new((rings[i][s], rings[i][t], rings[i + 1][t], rings[i + 1][s]))
    if cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end:
        bm.faces.new(rings[-1])
    return rings


# ==========================================================================
# Water, koi, lilies
# ==========================================================================

def build_water():
    objs = []
    x0, x1 = -11.0, 11.0
    y0, y1 = -13.0, 0.60      # tucks under the deck lip
    # Closed body of water so Volume Absorption has an interior to colour.
    bm = bmesh.new()
    bm_box(bm, ((x0 + x1) / 2, (y0 + y1) / 2, (WATER_LEVEL + POND_FLOOR) / 2),
           (x1 - x0, y1 - y0, WATER_LEVEL - POND_FLOOR))
    water = obj_from_bmesh("Engawa_Water", bm)
    water.data.materials.append(MATS["water"])
    objs.append(water)

    bed = grid_obj("Engawa_Pond_Bed", ((x0 + x1) / 2, (y0 + y1) / 2, POND_FLOOR - 0.01),
                   x1 - x0, y1 - y0, 14, 14, mat=MATS["pondbed"])
    objs.append(bed)

    # Ground all the way out, with the pond cut into it. Without this the
    # establishing render just stops at the edge of the water.
    bank_top = WATER_LEVEL + 0.09
    bm = bmesh.new()
    far = 46.0
    bm_box(bm, (0, (y0 - far) / 2, bank_top - 1.5), (far * 2, far - abs(y0), 3.0))
    for sx in (-1, 1):
        bm_box(bm, (sx * (x1 + far) / 2, (y0 + y1) / 2, bank_top - 1.5),
               (far - x1, y1 - y0, 3.0))
    bm_box(bm, (0, (y1 + far) / 2, bank_top - 1.5),
           (far * 2, far - abs(y1), 3.0))
    bank = obj_from_bmesh("Engawa_Ground", bm)
    bank.data.materials.append(MATS["grass"])
    objs.append(bank)
    # stone coping along the near lip of the pond, under the house
    bm = bmesh.new()
    bm_box(bm, (0, y1 - 0.10, bank_top - 0.34), (x1 * 2, 0.30, 0.78))
    coping = obj_from_bmesh("Engawa_Pond_Coping", bm)
    coping.data.materials.append(MATS["stone"])
    objs.append(coping)

    objs += build_koi()
    objs += build_lilies()
    return objs


def _koi(bm_body, bm_fin, origin, heading_deg, length, z):
    """One fish: lofted body, forked caudal fin, dorsal and pectorals."""
    a = math.radians(heading_deg)
    fwd = Vector((math.cos(a), math.sin(a), 0))
    side = Vector((-math.sin(a), math.cos(a), 0))
    o = Vector(origin) + Vector((0, 0, z))
    # gentle S-curve so it reads as swimming, not as a floating capsule
    prof = [(-0.50, 0.020, 0.022, 0.00), (-0.42, 0.048, 0.055, 0.01),
            (-0.28, 0.072, 0.082, 0.02), (-0.10, 0.078, 0.090, 0.01),
            (0.10, 0.066, 0.078, -0.02), (0.28, 0.044, 0.052, -0.04),
            (0.42, 0.022, 0.026, -0.05), (0.50, 0.010, 0.012, -0.055)]
    pts, radii = [], []
    for (u, rs, ru, lat) in prof:
        pts.append(o + fwd * (-u * length) + side * (lat * length))
        radii.append((rs * length, ru * length))
    loft_tube(bm_body, pts, radii, segments=10)
    tail_base = pts[-1]
    t = fwd * -1
    for sgn in (1, -1):
        v0 = bm_fin.verts.new(tail_base)
        v1 = bm_fin.verts.new(tail_base + t * (length * 0.20)
                              + Vector((0, 0, sgn * length * 0.16)))
        v2 = bm_fin.verts.new(tail_base + t * (length * 0.26)
                              + Vector((0, 0, sgn * length * 0.03)))
        bm_fin.faces.new((v0, v1, v2))
    # dorsal
    d0 = pts[2] + Vector((0, 0, radii[2][1] * 0.7))
    d1 = pts[4] + Vector((0, 0, radii[4][1] * 0.7))
    v = [bm_fin.verts.new(p) for p in
         (d0, d0 + Vector((0, 0, length * 0.075)),
          d1 + Vector((0, 0, length * 0.055)), d1)]
    bm_fin.faces.new(v)
    # pectorals
    for sgn in (1, -1):
        b = pts[2] + side * (sgn * radii[2][0] * 0.8)
        v = [bm_fin.verts.new(p) for p in
             (b, b + side * (sgn * length * 0.10) - fwd * (length * 0.06)
              + Vector((0, 0, -length * 0.03)),
              b - fwd * (length * 0.10))]
        bm_fin.faces.new(v)


def build_koi():
    bm_a, bm_fin = bmesh.new(), bmesh.new()
    bm_pale = bmesh.new()
    for (x, y, hd, ln, z) in [(-1.05, -1.28, 18, 0.44, -0.19),
                              (0.95, -1.80, 162, 0.40, -0.27),
                              (-0.96, -0.30, 3, 0.46, -0.130)]:
        _koi(bm_a, bm_fin, (x, y, 0), hd, ln, WATER_LEVEL + z)
    _koi(bm_pale, bm_fin, (-0.30, -1.78, 0), 74, 0.38, WATER_LEVEL - 0.30)
    koi = obj_from_bmesh("Engawa_Koi", bm_a, smooth=True)
    koi.data.materials.append(MATS["koi"])
    pale = obj_from_bmesh("Engawa_Koi_Pale", bm_pale, smooth=True)
    pale.data.materials.append(MATS["koi_pale"])
    fins = obj_from_bmesh("Engawa_Koi_Fins", bm_fin)
    fins.data.materials.append(MATS["koi_fin"])
    return [koi, pale, fins]


def build_lilies():
    bm = bmesh.new()
    rng = random.Random(41)
    pads = [(-1.48, -1.34, 0.145), (-1.06, -1.78, 0.105), (-1.82, -1.70, 0.170),
            (1.58, -1.48, 0.135), (1.30, -1.86, 0.155), (2.00, -1.16, 0.100),
            (-0.18, -1.98, 0.150), (0.34, -1.52, 0.115), (-2.20, -1.02, 0.125),
            (0.92, -2.02, 0.130), (0.66, -1.18, 0.095)]
    for (x, y, r) in pads:
        z = WATER_LEVEL + 0.006
        n = 22
        notch = rng.uniform(0, math.tau)
        centre = bm.verts.new((x, y, z))
        ring = []
        for i in range(n + 1):
            a = notch + 0.42 + (math.tau - 0.84) * i / n
            rr = r * (1.0 + 0.05 * math.sin(a * 5 + x))
            ring.append(bm.verts.new((x + math.cos(a) * rr, y + math.sin(a) * rr,
                                      z + 0.012 * math.sin(a * 3))))
        for i in range(n):
            bm.faces.new((centre, ring[i], ring[i + 1]))
    pad_obj = obj_from_bmesh("Engawa_Lily_Pads", bm, smooth=True)
    pad_obj.data.materials.append(MATS["lilypad"])

    # one lotus, lower left, where the reference puts its blossom
    bm_p, bm_c = bmesh.new(), bmesh.new()
    lx, ly, lz = -1.22, -1.86, WATER_LEVEL + 0.055
    for layer, (n, tilt, ln, wd) in enumerate([(8, 0.95, 0.155, 0.095),
                                               (7, 0.65, 0.135, 0.082),
                                               (6, 0.35, 0.105, 0.068)]):
        for i in range(n):
            a = math.tau * i / n + layer * 0.4
            d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt),
                        math.cos(tilt)))
            side = Vector((-math.sin(a), math.cos(a), 0))
            add_leaf(bm_p, (lx + math.cos(a) * 0.022, ly + math.sin(a) * 0.022,
                            lz + layer * 0.022),
                     d, side, ln, wd, droop=-0.12, fold=0.30)
    bm_cylinder(bm_c, (lx, ly, lz + 0.075), 0.030, 0.030, segments=12)
    petals = obj_from_bmesh("Engawa_Lotus", bm_p)
    petals.data.materials.append(MATS["lotus"])
    core = obj_from_bmesh("Engawa_Lotus_Core", bm_c, smooth=True)
    core.data.materials.append(MATS["lotus_core"])
    return [pad_obj, petals, core]


# ==========================================================================
# Floating oke (bucket) with watermelon and soda bottles
# ==========================================================================

def build_floating_bucket():
    cx, cy = -0.58, -0.86
    r_out, h = 0.255, 0.27
    rim_z = WATER_LEVEL + 0.170          # rides ~half out of the water
    bot_z = rim_z - h
    objs = []

    bm = bmesh.new()
    n = 26
    for i in range(n):
        a = math.tau * (i + 0.5) / n
        x, y = cx + math.cos(a) * (r_out - 0.011), cy + math.sin(a) * (r_out - 0.011)
        bm_box(bm, (x, y, (rim_z + bot_z) / 2 + 0.004),
               (0.026, 0.062, h - 0.01), rot=(0, 0, a))
    bm_cylinder(bm, (cx, cy, bot_z + 0.018), r_out - 0.018, 0.030, segments=n)
    bucket = obj_from_bmesh("Engawa_Oke_Staves", bm)
    bucket.data.materials.append(MATS["oke"])
    objs.append(bucket)

    bm = bmesh.new()
    for z, rr in ((rim_z - 0.035, r_out + 0.004), (bot_z + 0.060, r_out - 0.004)):
        inner, outer = [], []
        for i in range(n * 2):
            a = math.tau * i / (n * 2)
            inner.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr, z))
            outer.append((cx + math.cos(a) * (rr + 0.010),
                          cy + math.sin(a) * (rr + 0.010), z))
        vi = [bm.verts.new(p) for p in inner]
        vo = [bm.verts.new(p) for p in outer]
        vi2 = [bm.verts.new((p[0], p[1], p[2] + 0.022)) for p in inner]
        vo2 = [bm.verts.new((p[0], p[1], p[2] + 0.022)) for p in outer]
        for i in range(len(vi)):
            j = (i + 1) % len(vi)
            bm.faces.new((vo[i], vo[j], vo2[j], vo2[i]))
            bm.faces.new((vi[j], vi[i], vi2[i], vi2[j]))
            bm.faces.new((vi2[i], vi2[j], vo2[j], vo2[i]))
            bm.faces.new((vi[j], vo[j], vo[i], vi[i]))
    hoops = obj_from_bmesh("Engawa_Oke_Hoops", bm, smooth=True)
    hoops.data.materials.append(MATS["metal_dark"])
    objs.append(hoops)

    melon = sphere_obj("Engawa_Watermelon", (cx + 0.055, cy + 0.02, rim_z + 0.028),
                       0.145, mat=MATS["watermelon"], scale=(1.0, 1.0, 0.94),
                       subdiv=4)
    objs.append(melon)

    # two soda bottles leaning against the staves
    bm_g, bm_cap = bmesh.new(), bmesh.new()
    for (ox, oy, tilt, yaw, col) in [(-0.125, -0.055, 0.30, 1.2, "glass_blue"),
                                     (-0.150, 0.065, 0.26, -0.6, "glass_pink")]:
        base = Vector((cx + ox, cy + oy, bot_z + 0.045))
        d = Vector((math.cos(yaw) * math.sin(tilt), math.sin(yaw) * math.sin(tilt),
                    math.cos(tilt)))
        pts = [base + d * t for t in (0.0, 0.055, 0.105, 0.145, 0.175, 0.215, 0.245)]
        radii = [(0.037, 0.037), (0.038, 0.038), (0.037, 0.037), (0.030, 0.030),
                 (0.018, 0.018), (0.015, 0.015), (0.017, 0.017)]
        bmm = bmesh.new()
        loft_tube(bmm, pts, radii, segments=14)
        tmp = obj_from_bmesh("Engawa_Bottle_%s" % col, bmm, smooth=True)
        tmp.data.materials.append(MATS[col])
        objs.append(tmp)
        bm_cylinder(bm_cap, base + d * 0.258, 0.018, 0.018, segments=12,
                    rot=d.to_track_quat("Z", "Y").to_euler())
    caps = obj_from_bmesh("Engawa_Bottle_Caps", bm_cap, smooth=True)
    caps.data.materials.append(MATS["metal"])
    objs.append(caps)
    return objs


# ==========================================================================
# Deck props: side table with drinks, retro fan, popsicle wrapper
# ==========================================================================

def build_side_table():
    tx, ty = -1.52, 0.62
    top_z = 0.285
    objs = []
    bm = bmesh.new()
    bm_box(bm, (tx, ty, top_z - 0.018), (0.60, 0.46, 0.036))
    bm_box(bm, (tx, ty, top_z - 0.052), (0.54, 0.40, 0.032))     # apron
    for sx in (-1, 1):
        for sy in (-1, 1):
            bm_box(bm, (tx + sx * 0.25, ty + sy * 0.18, (top_z - 0.036) / 2),
                   (0.042, 0.042, top_z - 0.036))
    for sy in (-1, 1):
        bm_box(bm, (tx, ty + sy * 0.18, 0.075), (0.50, 0.028, 0.028))  # stretchers
    table = obj_from_bmesh("Engawa_Side_Table", bm)
    table.data.materials.append(MATS["timber"])
    objs.append(table)

    # ice bucket
    bx, by = tx + 0.16, ty + 0.09
    bucket = cyl_obj("Engawa_Ice_Bucket", (bx, by, top_z + 0.075), 0.090, 0.150,
                     segments=26, mat=MATS["metal"], radius_top=0.107)
    objs.append(bucket)
    bm = bmesh.new()
    rng = random.Random(5)
    for _ in range(9):
        a, rr = rng.uniform(0, math.tau), rng.uniform(0, 0.070)
        bm_box(bm, (bx + math.cos(a) * rr, by + math.sin(a) * rr,
                    top_z + 0.138 + rng.uniform(-0.01, 0.012)),
               (0.036, 0.036, 0.032), rot=(0, 0, rng.uniform(0, 1.5)))
    ice = obj_from_bmesh("Engawa_Ice_Cubes", bm)
    ice.data.materials.append(MATS["glass"])
    objs.append(ice)
    # two bottle necks out of the ice
    bm_b = bmesh.new()
    for (ox, oy, tilt, yaw) in [(-0.035, 0.010, 0.34, 2.6), (0.030, -0.020, 0.28, 0.4)]:
        base = Vector((bx + ox, by + oy, top_z + 0.075))
        d = Vector((math.cos(yaw) * math.sin(tilt), math.sin(yaw) * math.sin(tilt),
                    math.cos(tilt)))
        pts = [base + d * t for t in (0.0, 0.06, 0.10, 0.14, 0.175, 0.20)]
        radii = [(0.032, 0.032), (0.032, 0.032), (0.026, 0.026), (0.015, 0.015),
                 (0.013, 0.013), (0.015, 0.015)]
        loft_tube(bm_b, pts, radii, segments=12)
    bottles = obj_from_bmesh("Engawa_Bucket_Bottles", bm_b, smooth=True)
    bottles.data.materials.append(MATS["glass_blue"])
    objs.append(bottles)

    # tall glass of iced tea
    gx, gy = tx + 0.02, ty - 0.13
    glass = cyl_obj("Engawa_Iced_Tea_Glass", (gx, gy, top_z + 0.080), 0.038, 0.160,
                    segments=22, mat=MATS["glass"], radius_top=0.042,
                    cap_ends=False)
    objs.append(glass)
    tea = cyl_obj("Engawa_Iced_Tea", (gx, gy, top_z + 0.066), 0.035, 0.126,
                  segments=20, mat=MATS["tea"], radius_top=0.038)
    objs.append(tea)
    bm = bmesh.new()
    for i in range(5):
        a = i * 1.3
        bm_box(bm, (gx + math.cos(a) * 0.014, gy + math.sin(a) * 0.014,
                    top_z + 0.092 + i * 0.011), (0.026, 0.026, 0.024),
               rot=(0.3, 0.2, a))
    gice = obj_from_bmesh("Engawa_Tea_Ice", bm)
    gice.data.materials.append(MATS["glass"])
    objs.append(gice)

    # black plate with apples and green grapes
    px, py = tx - 0.17, ty + 0.05
    plate = cyl_obj("Engawa_Plate", (px, py, top_z + 0.010), 0.135, 0.020,
                    segments=28, mat=MATS["plate"], radius_top=0.165)
    objs.append(plate)
    bm = bmesh.new()
    for (ox, oy) in ((-0.045, 0.030), (0.048, 0.012)):
        bmesh_icosphere(bm, 3, 1.0,
                        Matrix.Translation((px + ox, py + oy, top_z + 0.070))
                        @ Matrix.Diagonal(Vector((0.058, 0.058, 0.052, 1.0))))
    apples = obj_from_bmesh("Engawa_Apples", bm, smooth=True)
    apples.data.materials.append(MATS["apple"])
    objs.append(apples)
    bm = bmesh.new()
    rng = random.Random(12)
    for i in range(16):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0, 0.055)
        bmesh_icosphere(
            bm, 2, 1.0,
            Matrix.Translation((px - 0.010 + math.cos(a) * rr,
                                py - 0.095 + math.sin(a) * rr * 0.6,
                                top_z + 0.030 + rng.uniform(0, 0.030)))
            @ Matrix.Diagonal(Vector((0.017, 0.017, 0.019, 1.0))))
    grapes = obj_from_bmesh("Engawa_Grapes", bm, smooth=True)
    grapes.data.materials.append(MATS["grape"])
    objs.append(grapes)
    return objs


def build_fan():
    """Retro mint desk fan, aimed back along -Y and a touch toward -X."""
    fx, fy = 1.52, 0.86
    yaw = math.radians(205)                 # facing out over the deck/water
    axis = Vector((math.cos(yaw), math.sin(yaw), 0))
    up = Vector((0, 0, 1))
    side = axis.cross(up).normalized()
    hub_z = 0.345
    hub = Vector((fx, fy, hub_z))
    rot = axis.to_track_quat("Z", "Y").to_euler()
    objs = []

    bm = bmesh.new()
    bm_cylinder(bm, (fx, fy, 0.022), 0.150, 0.044, segments=26, radius_top=0.125)
    bm_cylinder(bm, (fx, fy, 0.055), 0.118, 0.036, segments=26, radius_top=0.070)
    bm_cylinder(bm, (fx, fy, 0.185), 0.032, 0.230, segments=16)   # stem
    bm_cylinder(bm, hub - axis * 0.085, 0.088, 0.110, segments=22, axis="Z",
                rot=rot, radius_top=0.078)                        # motor can
    bm_cylinder(bm, hub - axis * 0.016, 0.026, 0.060, segments=12, axis="Z",
                rot=rot)                                          # hub
    body = obj_from_bmesh("Engawa_Fan_Body", bm, smooth=True)
    body.data.materials.append(MATS["fan_body"])
    objs.append(body)

    # blades
    bm = bmesh.new()
    for i in range(4):
        a = math.tau * i / 4
        for k in range(3):
            u = 0.055 + k * 0.048
            u2 = u + 0.048
            def pt(rad, ang, twist):
                d = (side * math.cos(ang) + up * math.sin(ang))
                return hub + d * rad + axis * (twist)
            q = [pt(u, a - 0.30, 0.006 * k), pt(u2, a - 0.34, 0.010 * (k + 1)),
                 pt(u2, a + 0.34, -0.010 * (k + 1)), pt(u, a + 0.30, -0.006 * k)]
            v = [bm.verts.new(p) for p in q]
            bm.faces.new(v)
    blades = obj_from_bmesh("Engawa_Fan_Blades", bm)
    blades.data.materials.append(MATS["fan_blade"])
    objs.append(blades)

    # wire cage: concentric rings plus radial wires, front and back
    bm = bmesh.new()
    cage_r = 0.205
    for depth, rings in ((0.075, (0.062, 0.118, 0.175, cage_r)),
                         (-0.070, (0.105, cage_r))):
        c = hub + axis * depth
        for rr in rings:
            pts, radii = [], []
            n = 30
            for i in range(n + 1):
                ang = math.tau * i / n
                pts.append(c + (side * math.cos(ang) + up * math.sin(ang)) * rr)
                radii.append((0.0035, 0.0035))
            loft_tube(bm, pts, radii, segments=5)
    for i in range(26):
        ang = math.tau * i / 26
        d = (side * math.cos(ang) + up * math.sin(ang))
        pts = [hub + axis * 0.075 + d * 0.060,
               hub + axis * 0.072 + d * 0.130,
               hub + axis * 0.052 + d * cage_r,
               hub + axis * 0.010 + d * (cage_r + 0.004)]
        loft_tube(bm, pts, [(0.0035, 0.0035)] * 4, segments=5)
    # rim band closing the cage
    pts, radii = [], []
    for i in range(41):
        ang = math.tau * i / 40
        pts.append(hub + axis * 0.005 + (side * math.cos(ang) + up * math.sin(ang))
                   * (cage_r + 0.010))
        radii.append((0.010, 0.010))
    loft_tube(bm, pts, radii, segments=6)
    cage = obj_from_bmesh("Engawa_Fan_Cage", bm, smooth=True)
    cage.data.materials.append(MATS["metal"])
    objs.append(cage)

    # cord trailing away across the planks
    bm = bmesh.new()
    pts, radii = [], []
    for i in range(30):
        t = i / 29
        x = fx + 0.12 + 0.78 * t + 0.09 * math.sin(t * 7.5)
        y = fy + 0.02 + 0.42 * t + 0.13 * math.sin(t * 5.0 + 1.1)
        z = max(0.006, 0.10 * (1 - t) ** 3 + 0.006)
        pts.append(Vector((x, y, z)))
        radii.append((0.0042, 0.0042))
    loft_tube(bm, pts, radii, segments=6)
    cord = obj_from_bmesh("Engawa_Fan_Cord", bm, smooth=True)
    cord.data.materials.append(MATS["cord"])
    objs.append(cord)
    return objs


def build_litter():
    """Discarded popsicle wrapper, creased, lying on the planks."""
    bm = bmesh.new()
    rng = random.Random(88)
    base = Vector((-0.62, -0.58, 0.0))
    for i in range(4):
        a = rng.uniform(0, math.tau)
        c = base + Vector((rng.uniform(-0.055, 0.055), rng.uniform(-0.045, 0.045),
                           0.0015 + i * 0.0022))
        bm_box(bm, c, (rng.uniform(0.07, 0.11), rng.uniform(0.035, 0.06), 0.0016),
               rot=(rng.uniform(-0.20, 0.20), rng.uniform(-0.20, 0.20), a))
    obj = obj_from_bmesh("Engawa_Popsicle_Wrapper", bm)
    obj.data.materials.append(MATS["wrapper"])
    return [obj]


# ==========================================================================
# Interior props: low chair, andon lantern, bonsai, tea set
# ==========================================================================

def build_interior_props():
    objs = []
    floor = TATAMI_TOP

    # --- low wooden chair with a woven seat ---------------------------
    cx, cy, yaw = -0.55, 2.55, math.radians(-24)
    bm, bms = bmesh.new(), bmesh.new()
    seat_z = floor + 0.285
    def R(px, py):
        return (cx + px * math.cos(yaw) - py * math.sin(yaw),
                cy + px * math.sin(yaw) + py * math.cos(yaw))
    for (sx, sy) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
        x, y = R(sx * 0.195, sy * 0.185)
        bm_box(bm, (x, y, floor + (seat_z - floor) / 2),
               (0.042, 0.042, seat_z - floor), rot=(0, 0, yaw))
    bm_box(bm, (cx, cy, seat_z + 0.015), (0.46, 0.44, 0.030), rot=(0, 0, yaw))
    # back rest, raked
    bxy = R(0.20, 0.0)
    bm_box(bm, (bxy[0], bxy[1], seat_z + 0.235), (0.050, 0.40, 0.44),
           rot=(0, -0.18, yaw))
    for dz in (0.10, 0.26, 0.40):
        p = R(0.20 + dz * 0.16, 0.0)
        bm_box(bm, (p[0], p[1], seat_z + dz), (0.030, 0.40, 0.045), rot=(0, -0.18, yaw))
    chair = obj_from_bmesh("Engawa_Low_Chair", bm)
    chair.data.materials.append(MATS["timber"])
    objs.append(chair)
    bm_box(bms, (cx, cy, seat_z + 0.036), (0.40, 0.38, 0.024), rot=(0, 0, yaw))
    cush = obj_from_bmesh("Engawa_Chair_Seat", bms)
    cush.data.materials.append(MATS["cushion"])
    objs.append(cush)

    # --- andon (paper lantern) -----------------------------------------
    lx, ly = -0.98, 2.16
    bm, bmp = bmesh.new(), bmesh.new()
    bm_cylinder(bm, (lx, ly, floor + 0.022), 0.135, 0.044, segments=18,
                radius_top=0.115)
    bm_cylinder(bm, (lx, ly, floor + 0.415), 0.125, 0.040, segments=18,
                radius_top=0.140)
    for i in range(6):
        a = math.tau * i / 6
        bm_box(bm, (lx + math.cos(a) * 0.108, ly + math.sin(a) * 0.108,
                    floor + 0.222), (0.022, 0.022, 0.360), rot=(0, 0, a))
    lant = obj_from_bmesh("Engawa_Lantern_Frame", bm, smooth=True)
    lant.data.materials.append(MATS["lattice"])
    objs.append(lant)
    bm_cylinder(bmp, (lx, ly, floor + 0.222), 0.102, 0.356, segments=20,
                cap_ends=False)
    shade = obj_from_bmesh("Engawa_Lantern_Shade", bmp, smooth=True)
    shade.data.materials.append(MATS["shoji"])
    objs.append(shade)

    # --- bonsai on its stand -------------------------------------------
    sx_, sy_ = 2.12, 3.22
    bm = bmesh.new()
    bm_box(bm, (sx_, sy_, floor + 0.325), (0.40, 0.36, 0.036))
    for (a, b) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
        bm_box(bm, (sx_ + a * 0.165, sy_ + b * 0.145, floor + 0.153),
               (0.036, 0.036, 0.307))
    bm_box(bm, (sx_, sy_, floor + 0.055), (0.36, 0.32, 0.026))
    stand = obj_from_bmesh("Engawa_Bonsai_Stand", bm)
    stand.data.materials.append(MATS["timber"])
    objs.append(stand)

    pot_z = floor + 0.343
    bm = bmesh.new()
    bm_box(bm, (sx_, sy_, pot_z + 0.055), (0.30, 0.20, 0.110))
    bm_box(bm, (sx_, sy_, pot_z + 0.115), (0.325, 0.225, 0.022))
    pot = obj_from_bmesh("Engawa_Bonsai_Pot", bm)
    pot.data.materials.append(MATS["ceramic_dark"])
    objs.append(pot)
    soil = box_obj("Engawa_Bonsai_Soil", (sx_, sy_, pot_z + 0.113),
                   (0.28, 0.18, 0.020), mat=MATS["soil"])
    objs.append(soil)

    bm_t, bm_l, bm_s = bmesh.new(), bmesh.new(), bmesh.new()
    rng = random.Random(202)
    trunk_pts = [Vector((sx_ - 0.03, sy_, pot_z + 0.11)),
                 Vector((sx_ - 0.05, sy_ + 0.01, pot_z + 0.19)),
                 Vector((sx_ + 0.01, sy_ - 0.01, pot_z + 0.26)),
                 Vector((sx_ + 0.06, sy_ + 0.01, pot_z + 0.31)),
                 Vector((sx_ + 0.03, sy_, pot_z + 0.37))]
    loft_tube(bm_t, trunk_pts, [(0.034, 0.034), (0.028, 0.028), (0.023, 0.023),
                                (0.018, 0.018), (0.013, 0.013)], segments=8)
    pads = [(Vector((sx_ - 0.13, sy_ + 0.02, pot_z + 0.30)), 0.13),
            (Vector((sx_ + 0.14, sy_ - 0.03, pot_z + 0.34)), 0.12),
            (Vector((sx_ + 0.01, sy_ + 0.01, pot_z + 0.44)), 0.14)]
    for i, (p, rr) in enumerate(pads):
        anchor = trunk_pts[min(len(trunk_pts) - 1, 1 + i)]
        loft_tube(bm_t, [anchor, (anchor + p) / 2, p],
                  [(0.016, 0.016), (0.012, 0.012), (0.008, 0.008)], segments=6)
        for _ in range(9):
            b = p + Vector((rng.uniform(-rr, rr), rng.uniform(-rr, rr),
                            rng.uniform(-0.03, 0.04)))
            d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 0.8)))
            add_twig(bm_l, bm_s, b, d, 0.065, rng.randint(4, 6), 0.036, 0.014,
                     rng, thickness=0.004)
    trunk = obj_from_bmesh("Engawa_Bonsai_Trunk", bm_t, smooth=True)
    trunk.data.materials.append(MATS["bark"])
    bl = obj_from_bmesh("Engawa_Bonsai_Leaves", bm_l)
    bl.data.materials.append(MATS["leaf_bonsai"])
    bs = obj_from_bmesh("Engawa_Bonsai_Stems", bm_s)
    bs.data.materials.append(MATS["stem"])
    objs += [trunk, bl, bs]

    # --- tea set on the tatami ------------------------------------------
    tx, ty = 1.30, 2.48
    bm = bmesh.new()
    bmesh_icosphere(bm, 3, 1.0, Matrix.Translation((tx, ty, floor + 0.075))
                    @ Matrix.Diagonal(Vector((0.105, 0.105, 0.072, 1.0))))
    bm_cylinder(bm, (tx, ty, floor + 0.128), 0.046, 0.022, segments=14,
                radius_top=0.040)
    bmesh_icosphere(bm, 2, 1.0, Matrix.Translation((tx, ty, floor + 0.150))
                    @ Matrix.Diagonal(Vector((0.018, 0.018, 0.016, 1.0))))
    # spout
    sp = [Vector((tx - 0.085, ty + 0.01, floor + 0.080)),
          Vector((tx - 0.135, ty + 0.015, floor + 0.105)),
          Vector((tx - 0.170, ty + 0.02, floor + 0.125))]
    loft_tube(bm, sp, [(0.024, 0.024), (0.016, 0.016), (0.011, 0.011)], segments=10)
    # handle
    hp = [Vector((tx + 0.085, ty, floor + 0.085)),
          Vector((tx + 0.130, ty, floor + 0.130)),
          Vector((tx + 0.105, ty, floor + 0.168)),
          Vector((tx + 0.035, ty, floor + 0.160))]
    loft_tube(bm, hp, [(0.011, 0.011)] * 4, segments=8)
    pot_o = obj_from_bmesh("Engawa_Teapot", bm, smooth=True)
    pot_o.data.materials.append(MATS["ceramic_dark"])
    objs.append(pot_o)

    bm = bmesh.new()
    for (ox, oy) in ((0.22, -0.06), (0.20, 0.10)):
        bm_cylinder(bm, (tx + ox, ty + oy, floor + 0.026), 0.034, 0.052,
                    segments=14, radius_top=0.042)
    bm_cylinder(bm, (tx - 0.26, ty + 0.05, floor + 0.030), 0.060, 0.060,
                segments=16, radius_top=0.052)
    cups = obj_from_bmesh("Engawa_Tea_Cups", bm, smooth=True)
    cups.data.materials.append(MATS["ceramic"])
    objs.append(cups)
    bm = bmesh.new()
    bm_cylinder(bm, (tx - 0.26, ty + 0.05, floor + 0.066), 0.052, 0.014,
                segments=16, radius_top=0.058)
    bell = obj_from_bmesh("Engawa_Brass_Dish", bm, smooth=True)
    bell.data.materials.append(MATS["brass"])
    objs.append(bell)
    return objs


# ==========================================================================
# Furin (glass wind chime) hanging from the eave
# ==========================================================================

def build_furin():
    fx, fy = 0.56, -0.34
    top_z = EAVE_Z - 0.075
    bell_top = 2.46
    objs = []
    # cord from the soffit down to the bell
    bm = bmesh.new()
    loft_tube(bm, [Vector((fx, fy, top_z)), Vector((fx, fy, bell_top))],
              [(0.0035, 0.0035)] * 2, segments=5)
    cord = obj_from_bmesh("Engawa_Furin_Cord", bm, smooth=True)
    cord.data.materials.append(MATS["cord"])
    objs.append(cord)

    # bell: a dome open at the bottom, swept as a profile of revolution
    bm = bmesh.new()
    prof = [(0.008, 0.000), (0.030, -0.012), (0.048, -0.036), (0.056, -0.068),
            (0.054, -0.098), (0.049, -0.116)]
    n = 24
    rings = []
    for (r, dz) in prof:
        ring = [bm.verts.new((fx + math.cos(math.tau * i / n) * r,
                              fy + math.sin(math.tau * i / n) * r,
                              bell_top + dz)) for i in range(n)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(n):
            t = (s + 1) % n
            bm.faces.new((rings[i][s], rings[i][t], rings[i + 1][t], rings[i + 1][s]))
    bm.faces.new(list(reversed(rings[0])))
    bell = obj_from_bmesh("Engawa_Furin_Bell", bm, smooth=True)
    bell.data.materials.append(MATS["glass"])
    objs.append(bell)

    # clapper + the paper tanzaku strip that catches the breeze
    bm = bmesh.new()
    loft_tube(bm, [Vector((fx, fy, bell_top - 0.02)),
                   Vector((fx, fy, bell_top - 0.135))],
              [(0.0022, 0.0022)] * 2, segments=5)
    thread = obj_from_bmesh("Engawa_Furin_Thread", bm, smooth=True)
    thread.data.materials.append(MATS["cord"])
    objs.append(thread)
    clap = sphere_obj("Engawa_Furin_Clapper", (fx, fy, bell_top - 0.075), 0.012,
                      mat=MATS["glass"])
    objs.append(clap)
    bm = bmesh.new()
    for i in range(4):
        z0 = bell_top - 0.135 - i * 0.042
        tw = 0.16 + i * 0.10
        bm_box(bm, (fx + math.sin(i * 0.9) * 0.008, fy, z0 - 0.021),
               (0.048, 0.0015, 0.044), rot=(0, 0, tw))
    tag = obj_from_bmesh("Engawa_Furin_Tag", bm)
    tag.data.materials.append(MATS["paper"])
    objs.append(tag)
    return objs


# ==========================================================================
# The cat
# ==========================================================================

def build_cat_material():
    """White fur. Left near-neutral on purpose: the warm/cool split comes from
    the light (warm sun, blue sky fill) plus a shallow warm subsurface, which
    reads far better than painting a gradient into the base colour."""
    m = make_mat("EngawaCatFur", base=(0.855, 0.840, 0.815), rough=0.78, spec=0.22)
    nt, bsdf = mat_nodes(m)
    for key, val in (("Subsurface Weight", 0.22), ("Subsurface", 0.22)):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = val
            break
    if "Subsurface Radius" in bsdf.inputs:
        bsdf.inputs["Subsurface Radius"].default_value = (0.020, 0.009, 0.006)
    for key, val in (("Subsurface Scale", 0.02),):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = val
    for key in ("Sheen Weight", "Sheen"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.45
            break
    if "Sheen Roughness" in bsdf.inputs:
        bsdf.inputs["Sheen Roughness"].default_value = 0.35
    # fine directional fur bump + a whisper of warm/cool mottling
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.35, 3.0, 3.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 110.0
    nz.inputs["Detail"].default_value = 8.0
    nz.inputs["Roughness"].default_value = 0.75
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    # a coarser second layer so the coat has soft clumps as well as fibres
    mp2 = nt.nodes.new("ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (0.5, 2.0, 2.0)
    nt.links.new(tc.outputs["Object"], mp2.inputs["Vector"])
    nz2 = nt.nodes.new("ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 14.0
    nz2.inputs["Detail"].default_value = 5.0
    nt.links.new(mp2.outputs["Vector"], nz2.inputs["Vector"])
    fmix = nt.nodes.new("ShaderNodeMixRGB")
    fmix.inputs["Fac"].default_value = 0.45
    nt.links.new(nz.outputs["Fac"], fmix.inputs["Color1"])
    nt.links.new(nz2.outputs["Fac"], fmix.inputs["Color2"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.36
    rr.color_ramp.elements[0].color = (0.680, 0.665, 0.650, 1.0)
    rr.color_ramp.elements[1].position = 0.66
    rr.color_ramp.elements[1].color = (0.935, 0.920, 0.885, 1.0)
    nt.links.new(fmix.outputs["Color"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    add_bump(m, fmix.outputs["Color"], strength=0.60, distance=0.010)
    MATS["cat_fur"] = m
    MATS["cat_pink"] = make_mat("EngawaCatPink", base=(0.880, 0.470, 0.470),
                                rough=0.42, spec=0.35)
    MATS["cat_dark"] = make_mat("EngawaCatDark", base=(0.190, 0.150, 0.135),
                                rough=0.45, spec=0.4)
    return m


def build_cat():
    """A white cat asleep on the planks: loaf pose, front paws stretched out,
    tail curled round the near side, ears up, eyes shut.

    Built in cat-local coordinates (nose at -X, rump at +X, belly on Z=0) and
    then placed as a group under its own empty so the composition pass can
    nudge or re-aim it without touching the rest of the set."""
    build_cat_material()
    fur, pink, dark = MATS["cat_fur"], MATS["cat_pink"], MATS["cat_dark"]
    bm = bmesh.new()

    # --- torso: a loaf that settles onto the deck. Stations are sunk a
    # little below their own radius so the belly spreads on the planks
    # instead of resting on a tangent point. Nose-to-tail-base is 0.42 m and
    # the back sits 0.17 m off the deck -- a real cat, not a scaled dog.
    body = [(-0.198, 0.000, 0.038, 0.044),
            (-0.152, 0.003, 0.059, 0.069),
            (-0.078, 0.006, 0.072, 0.083),
            (0.008, 0.008, 0.079, 0.088),
            (0.090, 0.008, 0.076, 0.084),
            (0.160, 0.002, 0.067, 0.073),
            (0.216, -0.011, 0.047, 0.051),
            (0.252, -0.026, 0.029, 0.031)]
    pts = [Vector((x, y, ru * 0.92)) for (x, y, rs, ru) in body]
    radii = [(rs, ru) for (x, y, rs, ru) in body]
    loft_tube(bm, pts, radii, segments=16)

    # --- head, muzzle, cheeks
    head_c = Vector((-0.262, 0.004, 0.119))
    bmesh_icosphere(bm, 3, 1.0, Matrix.Translation(head_c)
                    @ Matrix.Diagonal(Vector((0.066, 0.058, 0.056, 1.0))))
    bmesh_icosphere(bm, 3, 1.0, Matrix.Translation(head_c + Vector((-0.044, 0, -0.017)))
                    @ Matrix.Diagonal(Vector((0.035, 0.037, 0.026, 1.0))))
    for s in (-1, 1):
        bmesh_icosphere(bm, 2, 1.0,
                        Matrix.Translation(head_c + Vector((-0.024, s * 0.037, -0.010)))
                        @ Matrix.Diagonal(Vector((0.030, 0.024, 0.026, 1.0))))
    # ears: solid pyramids standing proud of the skull, canted outward
    for s in (-1, 1):
        bc = head_c + Vector((0.000, s * 0.036, 0.030))
        tip = head_c + Vector((-0.008, s * 0.052, 0.108))
        a = bm.verts.new(bc + Vector((0.031, 0, 0)))
        b = bm.verts.new(bc + Vector((-0.031, 0, 0)))
        c = bm.verts.new(bc + Vector((0.0, s * 0.018, 0.008)))
        t = bm.verts.new(tip)
        bm.faces.new((a, b, c))
        bm.faces.new((a, t, b))
        bm.faces.new((b, t, c))
        bm.faces.new((c, t, a))

    # --- front legs stretched out past the nose, paws relaxed
    for s in (-1, 1):
        leg = [Vector((-0.140, s * 0.050, 0.060)),
               Vector((-0.200, s * 0.046, 0.040)),
               Vector((-0.268, s * 0.042, 0.024)),
               Vector((-0.330, s * 0.040, 0.019)),
               Vector((-0.362, s * 0.040, 0.018))]
        loft_tube(bm, leg, [(0.037, 0.036), (0.029, 0.028), (0.022, 0.021),
                            (0.019, 0.017), (0.018, 0.016)], segments=10)
        bmesh_icosphere(bm, 3, 1.0,
                        Matrix.Translation(Vector((-0.373, s * 0.040, 0.017)))
                        @ Matrix.Diagonal(Vector((0.022, 0.019, 0.015, 1.0))))
        for t in (-1, 0, 1):          # toes
            bmesh_icosphere(bm, 2, 1.0,
                            Matrix.Translation(Vector((-0.390, s * 0.040 + t * 0.012,
                                                       0.014)))
                            @ Matrix.Diagonal(Vector((0.011, 0.009, 0.008, 1.0))))

    # --- haunches, and one back foot tucked under the near flank
    for s in (-1, 1):
        bmesh_icosphere(bm, 3, 1.0,
                        Matrix.Translation(Vector((0.132, s * 0.052, 0.062)))
                        @ Matrix.Diagonal(Vector((0.072, 0.040, 0.058, 1.0))))
    bmesh_icosphere(bm, 3, 1.0,
                    Matrix.Translation(Vector((0.012, -0.086, 0.019)))
                    @ Matrix.Diagonal(Vector((0.046, 0.026, 0.016, 1.0))))

    # --- tail, curled forward round the near flank
    tail = [Vector((0.262, -0.034, 0.032)), Vector((0.290, -0.082, 0.026)),
            Vector((0.262, -0.126, 0.023)), Vector((0.182, -0.146, 0.021)),
            Vector((0.082, -0.145, 0.020)), Vector((-0.020, -0.132, 0.019)),
            Vector((-0.108, -0.114, 0.019)), Vector((-0.158, -0.098, 0.018))]
    loft_tube(bm, tail, [(0.028, 0.027), (0.026, 0.025), (0.024, 0.023),
                         (0.022, 0.021), (0.020, 0.019), (0.017, 0.016),
                         (0.014, 0.013), (0.010, 0.010)], segments=10)

    body_obj = obj_from_bmesh("Cat_Body", bm, smooth=True)
    body_obj.data.materials.append(fur)

    # --- pink nose and inner ears
    bm = bmesh.new()
    bmesh_icosphere(bm, 2, 1.0,
                    Matrix.Translation(head_c + Vector((-0.068, 0.0, -0.013)))
                    @ Matrix.Diagonal(Vector((0.008, 0.011, 0.007, 1.0))))
    for s in (-1, 1):
        bc = head_c + Vector((0.000, s * 0.040, 0.032))
        tip = head_c + Vector((-0.008, s * 0.052, 0.100))
        v0 = bm.verts.new(bc + Vector((0.022, 0, 0.0)))
        v1 = bm.verts.new(bc + Vector((-0.022, 0, 0.0)))
        v2 = bm.verts.new(tip)
        bm.faces.new((v0, v1, v2))
    pinks = obj_from_bmesh("Cat_Pink", bm, smooth=True)
    pinks.data.materials.append(pink)

    # --- shut eyes: two shallow creased slits
    bm = bmesh.new()
    for s in (-1, 1):
        c = head_c + Vector((-0.044, s * 0.031, 0.010))
        for i in range(6):
            u0, u1 = i / 6, (i + 1) / 6
            def arc(u):
                return c + Vector((-0.002 + 0.003 * math.sin(u * math.pi),
                                   (u - 0.5) * 0.034,
                                   0.005 * math.sin(u * math.pi)))
            a0, a1 = arc(u0), arc(u1)
            v = [bm.verts.new(p) for p in
                 (a0 + Vector((0.019, 0, 0.0030)), a1 + Vector((0.019, 0, 0.0030)),
                  a1 + Vector((0.019, 0, -0.0030)), a0 + Vector((0.019, 0, -0.0030)))]
            bm.faces.new(v)
    eyes = obj_from_bmesh("Cat_Eyes", bm, smooth=True)
    eyes.data.materials.append(dark)

    # --- whiskers, just enough to catch a highlight
    bm = bmesh.new()
    for s in (-1, 1):
        for k in range(2):
            b = head_c + Vector((-0.052, s * 0.024, -0.004 + k * 0.009))
            e = b + Vector((-0.050 - k * 0.008, s * (0.056 + k * 0.010),
                            0.006 - k * 0.010))
            loft_tube(bm, [b, (b + e) / 2, e],
                      [(0.0009, 0.0009), (0.0007, 0.0007), (0.0004, 0.0004)],
                      segments=4)
    whisk = obj_from_bmesh("Cat_Whiskers", bm, smooth=True)
    whisk.data.materials.append(MATS["cat_fur"])

    # --- place: beside (not inside) the character footprint, lying roughly
    # along the deck edge, nose angled toward the water.
    root = bpy.data.objects.new("Cat", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(root)
    _register(root)
    root.location = (0.36, -0.12, 0.0)
    root.rotation_euler = (0.0, 0.0, math.radians(35))
    for o in (body_obj, pinks, eyes, whisk):
        o.parent = root
    return root


# ==========================================================================
# Lighting and world
# ==========================================================================

# Sun geometry: the eave overhangs to Y = EAVE_FRONT at Z = EAVE_Z, so a sun
# coming in from over the water at elevation E throws the eave's shadow line
# onto the deck at  Y = EAVE_FRONT + EAVE_Z / tan(E).  At ~54 deg that lands
# near Y = +0.85, which puts the front half of the deck in hard sun and the
# strip against the house in cool shade -- the exact light split the reference
# is built on. Change SUN_ELEVATION and the whole mood moves with it.
SUN_ELEVATION = 58.0
SUN_AZIMUTH = 252.0        # degrees CCW from +X: light arrives from over the water


def _sun_vector(elev_deg=SUN_ELEVATION, azim_deg=SUN_AZIMUTH):
    e, a = math.radians(elev_deg), math.radians(azim_deg)
    return Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a),
                   math.sin(e)))


def build_lighting(dappled=True):
    """Bright summer afternoon. Everything the mood depends on lives here so a
    composition pass can swap the whole rig without touching the geometry."""
    scene = bpy.context.scene
    made = []

    # --- world: physical sky, sun disc off (the sun lamp does that job) ----
    world = scene.world or bpy.data.worlds.new("EngawaWorld")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_WORLD":
            nt.nodes.remove(n)
    out = nt.nodes["World Output"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_disc = False
        sky.sun_elevation = math.radians(SUN_ELEVATION)
        sky.sun_rotation = math.radians(SUN_AZIMUTH - 90.0)
        sky.altitude = 250.0
        sky.air_density = 1.1
        sky.dust_density = 1.6      # slight haze -> summer, not alpine
        sky.ozone_density = 1.0
    except (AttributeError, TypeError):
        pass
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 1.75
    nt.links.new(sky.outputs[0], hsv.inputs["Color"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.30
    nt.links.new(hsv.outputs[0], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])

    # --- the sun -----------------------------------------------------------
    sd = bpy.data.lights.new("Engawa_Sun", type="SUN")
    sd.energy = 13.0
    sd.angle = math.radians(0.60)     # close to the real solar disc
    sd.color = (1.0, 0.930, 0.815)
    sun = bpy.data.objects.new("Engawa_Sun", sd)
    scene.collection.objects.link(sun)
    _register(sun)
    v = _sun_vector()
    sun.location = v * 24.0 + Vector((0, 0.4, 0))
    sun.rotation_euler = (-v).to_track_quat("-Z", "Y").to_euler()
    made.append(sun)

    # --- dappled-light gobo -------------------------------------------------
    # A leaf-canopy stand-in, high above and out of shot: invisible to camera
    # and to indirect rays, but it still casts, so the sun arrives on the
    # planks in broken warm patches instead of one flat sheet. This is most of
    # the reason the deck reads as "hot afternoon under a tree".
    if dappled:
        gobo_mat = bpy.data.materials.new("EngawaGobo")
        gobo_mat.use_nodes = True
        gnt = gobo_mat.node_tree
        for n in list(gnt.nodes):
            if n.type != "OUTPUT_MATERIAL":
                gnt.nodes.remove(n)
        gout = gnt.nodes["Material Output"]
        transp = gnt.nodes.new("ShaderNodeBsdfTransparent")
        shade = gnt.nodes.new("ShaderNodeBsdfTransparent")
        shade.inputs["Color"].default_value = (0.045, 0.075, 0.055, 1.0)
        tcg = gnt.nodes.new("ShaderNodeTexCoord")
        mpg = gnt.nodes.new("ShaderNodeMapping")
        mpg.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        mpg.inputs["Location"].default_value = (1.06, 0.87, 0.0)
        mpg.inputs["Rotation"].default_value = (0, 0, math.radians(38))
        gnt.links.new(tcg.outputs["Object"], mpg.inputs["Vector"])
        vor = gnt.nodes.new("ShaderNodeTexVoronoi")
        vor.feature = "F1"
        vor.inputs["Scale"].default_value = 2.30
        gnt.links.new(mpg.outputs["Vector"], vor.inputs["Vector"])
        nzg = gnt.nodes.new("ShaderNodeTexNoise")
        nzg.inputs["Scale"].default_value = 4.2
        nzg.inputs["Detail"].default_value = 6.0
        gnt.links.new(mpg.outputs["Vector"], nzg.inputs["Vector"])
        mixg = gnt.nodes.new("ShaderNodeMixRGB")
        mixg.inputs["Fac"].default_value = 0.55
        gnt.links.new(vor.outputs["Distance"], mixg.inputs["Color1"])
        gnt.links.new(nzg.outputs["Fac"], mixg.inputs["Color2"])
        rampg = gnt.nodes.new("ShaderNodeValToRGB")
        rampg.color_ramp.elements[0].position = 0.38
        rampg.color_ramp.elements[1].position = 0.52
        gnt.links.new(mixg.outputs["Color"], rampg.inputs["Fac"])
        mixs = gnt.nodes.new("ShaderNodeMixShader")
        gnt.links.new(rampg.outputs["Color"], mixs.inputs["Fac"])
        gnt.links.new(shade.outputs[0], mixs.inputs[1])
        gnt.links.new(transp.outputs[0], mixs.inputs[2])
        gnt.links.new(mixs.outputs[0], gout.inputs["Surface"])

        # Height matters: the lower the canopy, the harder the leaf edges.
        gobo = plane_obj("Engawa_Light_Gobo", (-1.0, -1.5, 5.0), 44.0, 44.0,
                         mat=gobo_mat)
        gobo.visible_camera = False
        gobo.visible_diffuse = False
        gobo.visible_glossy = False
        gobo.visible_transmission = False
        gobo.visible_volume_scatter = False
        gobo.visible_shadow = True
        made.append(gobo)

    # --- interior bounce: the room would otherwise be a cave -------------
    def area(name, loc, target, energy, size, color, size_y=None):
        ld = bpy.data.lights.new(name, type="AREA")
        ld.energy = energy
        ld.shape = "RECTANGLE" if size_y else "SQUARE"
        ld.size = size
        if size_y:
            ld.size_y = size_y
        ld.color = color
        o = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(o)
        _register(o)
        o.location = loc
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat(
            "-Z", "Y").to_euler()
        made.append(o)
        return o

    area("Engawa_Interior_Bounce", (0.4, 3.2, 2.35), (0.2, 2.4, 0.3),
         42.0, 3.6, (1.0, 0.93, 0.81), size_y=2.2)
    # behind the closed shoji: what makes the paper glow instead of reading grey
    area("Engawa_Shoji_Backlight", (-2.9, 2.9, 1.20), (-2.9, 1.6, 1.05),
         60.0, 2.4, (1.0, 0.96, 0.86), size_y=1.9)
    # cool skylight fill from over the water -- keeps shadows blue, not black
    area("Engawa_Water_Fill", (-1.5, -6.0, 4.6), (0.0, 0.4, -0.3),
         55.0, 9.0, (0.78, 0.89, 1.0), size_y=7.0)
    # The strip of pond tucked under the deck lip is the only water the
    # shipping camera can see, and it sits in the deck's own shadow. A low,
    # warm bounce standing in for light kicking off the bright boards keeps
    # it (and the koi in it) from going to black.
    area("Engawa_Underdeck_Bounce", (-1.0, -1.85, -0.32), (-0.95, -0.35, -0.92),
         95.0, 2.2, (1.0, 0.91, 0.78), size_y=0.8)

    # Gather the rig under its own empty, itself a child of Scene_Engawa when
    # that exists: the whole set still moves and hides as one, but a
    # composition pass can delete or swap just "Engawa_Lighting".
    rig = bpy.data.objects.new("Engawa_Lighting", None)
    rig.empty_display_type = "SINGLE_ARROW"
    rig.empty_display_size = 0.5
    scene.collection.objects.link(rig)
    _register(rig)
    root = bpy.data.objects.get("Scene_Engawa")
    if root is not None:
        rig.parent = root
    for o in made:
        o.parent = rig
    return made


def configure_render(samples=None, resolution=(1080, 1920)):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.film_transparent = False
    scene.render.resolution_x = int(resolution[0] * RENDER_SCALE)
    scene.render.resolution_y = int(resolution[1] * RENDER_SCALE)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    cyc = scene.cycles
    cyc.samples = samples or RENDER_SAMPLES
    # This apt Blender has no OpenImageDenoise compiled in; enabling denoising
    # is a hard RuntimeError, so buy the same cleanliness with samples.
    cyc.use_denoising = False
    cyc.use_adaptive_sampling = True
    cyc.adaptive_threshold = 0.012
    cyc.device = "CPU"
    cyc.max_bounces = 10
    cyc.transmission_bounces = 8
    cyc.transparent_max_bounces = 12
    cyc.volume_bounces = 2
    cyc.caustics_reflective = False
    cyc.caustics_refractive = False
    cyc.blur_glossy = 0.35
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        try:
            scene.view_settings.look = "Punchy"
        except TypeError:
            pass
    scene.view_settings.exposure = -0.35
    scene.view_settings.gamma = 1.0


SENSOR_H = 24.0


def setup_camera(name, location, target, lens=35.0, shift_y=0.0):
    """Camera at `location` aimed at `target`, on a vertical-fit 24 mm sensor
    so the vertical field of view depends only on the lens, not on whatever
    aspect ratio a given shot renders at."""
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = SENSOR_H
    cd.shift_y = shift_y
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    q = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y")
    cam.rotation_euler = q.to_euler()
    bpy.context.scene.camera = cam
    return cam


# ==========================================================================
# Assembly
# ==========================================================================

def clear_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.lights, bpy.data.cameras):
        for item in list(coll):
            coll.remove(item, do_unlink=True)
    _created.clear()


def build_scene():
    """Build the whole engawa set into the current scene.

    Returns the "Scene_Engawa" empty that everything hangs off. Does NOT
    build lights, camera or render settings -- call build_lighting() and
    configure_render() for those, or supply your own.
    """
    _created.clear()
    build_materials()
    build_deck()
    build_house()
    build_water()
    build_floating_bucket()
    build_side_table()
    build_fan()
    build_litter()
    build_interior_props()
    build_garden_beyond()
    build_furin()
    build_bamboo()
    cat = build_cat()

    root = bpy.data.objects.new("Scene_Engawa", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.6
    bpy.context.scene.collection.objects.link(root)
    for obj in list(_created):
        if obj is root:
            continue
        if obj.parent is None:
            obj.parent = root
    _created.append(root)
    bpy.context.view_layer.update()
    log(f"built {len([o for o in _created if o.type == 'MESH'])} meshes; "
        f"cat root at {tuple(round(v, 3) for v in cat.location)}")
    return root


def _render(path, samples, resolution):
    scene = bpy.context.scene
    configure_render(samples=samples, resolution=resolution)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("rendered", path)


def verify_conventions():
    """Cheap self-check on the two things the character workstream relies on:
    the deck surface really is Z = 0, and nothing is parked in the footprint."""
    deck = bpy.data.objects.get("Engawa_Deck_Planks")
    if deck:
        top = max((deck.matrix_world @ v.co).z for v in deck.data.vertices)
        log(f"deck top surface Z = {top:+.6f} (contract: 0.000000)")
    intruders = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("Engawa_Water"):
            continue
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            if (CLEAR_X[0] < w.x < CLEAR_X[1] and CLEAR_Y[0] < w.y < CLEAR_Y[1]
                    and 0.002 < w.z < 2.0):
                intruders[obj.name] = intruders.get(obj.name, 0) + 1
    if intruders:
        log("WARNING: geometry inside the character footprint:", intruders)
    else:
        log("character footprint X[-1.2,1.2] Y[-0.4,0.9] is clear")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    clear_scene()
    build_scene()
    build_lighting()

    samples = RENDER_SAMPLES

    verify_conventions()

    # 1. Wide establishing shot: the whole set, three-quarters on.
    setup_camera("Cam_Wide", (-7.3, -8.9, 3.55), (-0.10, 1.10, 0.85), lens=40.0)
    _render(os.path.join(OUT_DIR, "scene_test_wide.png"),
            int(samples * 0.8), (1280, 720))

    # 2. The reference framing: high, out over the water, looking down the
    #    deck. Portrait, 18mm on a 24mm vertical sensor -- wide enough that
    #    the deck fills the middle third, the house stacks behind it, the pond
    #    takes the bottom quarter and the bamboo reaches into the top corners.
    #    (The corners sit only ~2m from the lens, in front of the eave: that
    #    is why the framing bamboo hangs where it does rather than off at the
    #    sides where the culms are.)
    setup_camera("Cam_Hero", (0.62, -2.75, 3.60), (0.20, 0.50, -0.05), lens=18.0)
    _render(os.path.join(OUT_DIR, "scene_test_camera.png"), samples, (900, 1600))
    log("done")


if __name__ == "__main__":
    main()
