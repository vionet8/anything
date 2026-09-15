#!/usr/bin/env python3
"""Check a pose against how joints actually work, instead of against a render.

A wrong pose and a right pose cost the same to render and look equally
deliberate in a thumbnail, so "does this look ok" is the wrong question to ask
of a picture. The questions that matter have numbers: does this knee bend the
way a knee bends, and does it bend further than a knee bends.

Two rules cover most of it.

A knee and an elbow are HINGES. They fold one way only. Which way is not a
matter of taste: a knee folds so the heel approaches the buttock, which moves
the ankle behind the thigh; an elbow folds so the hand approaches the
shoulder, which moves the wrist in front of the upper arm. Bending either the
other way is hyperextension, and it is the single most obvious way a posed
figure reads as broken -- it is the thing people mean when they say a model
looks like a doll.

And every joint has a RANGE. A knee reaches about 145 degrees and stops. Past
that the shin is inside the thigh.

Everything is measured in the armature's own space, so the answers do not
change when the whole figure is rotated to lie down -- which is the point: a
pose is wrong or right on its own, before anyone decides where to put it.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# She faces +Y in the rest pose (blender_character's stated convention), so in
# armature space +Y is in front of her and -Y is behind.
ANTERIOR = Vector((0.0, 1.0, 0.0))

# Below this much flexion a joint counts as straight and its fold direction is
# not tested.
STRAIGHT_ENOUGH = 12.0

# joint, the three bones that make it, which way the far end must travel when
# it folds, and how far it folds before it is not a joint any more.
HINGES = (
    ("L knee",  "J_Bip_L_UpperLeg", "J_Bip_L_LowerLeg", "J_Bip_L_Foot", -1, 145.0),
    ("R knee",  "J_Bip_R_UpperLeg", "J_Bip_R_LowerLeg", "J_Bip_R_Foot", -1, 145.0),
    ("L elbow", "J_Bip_L_UpperArm", "J_Bip_L_LowerArm", "J_Bip_L_Hand",  +1, 145.0),
    ("R elbow", "J_Bip_R_UpperArm", "J_Bip_R_LowerArm", "J_Bip_R_Hand",  +1, 145.0),
)

# Ball joints: how far the limb may swing from where it rests, in degrees.
# Generous on purpose -- these catch the gross errors, not the last 10 degrees.
BALLS = (
    ("L hip",      "J_Bip_C_Hips",      "J_Bip_L_UpperLeg", "J_Bip_L_LowerLeg", 125.0),
    ("R hip",      "J_Bip_C_Hips",      "J_Bip_R_UpperLeg", "J_Bip_R_LowerLeg", 125.0),
    ("L shoulder", "J_Bip_C_UpperChest", "J_Bip_L_UpperArm", "J_Bip_L_LowerArm", 170.0),
    ("R shoulder", "J_Bip_C_UpperChest", "J_Bip_R_UpperArm", "J_Bip_R_LowerArm", 170.0),
    ("neck",       "J_Bip_C_Chest",     "J_Bip_C_Neck",     "J_Bip_C_Head",      70.0),
)


def log(*a):
    print("[anatomy]", *a, flush=True)


def _local(arm, bone_name, tail=False):
    """A joint's position in the armature's own space."""
    pb = arm.pose.bones[bone_name]
    return pb.tail.copy() if tail else pb.head.copy()


def _segment_dirs(arm, proximal, joint, distal):
    a = _local(arm, proximal)
    b = _local(arm, joint)
    c = _local(arm, distal)
    return a, b, c


def check_hinges(arm, hinges=HINGES):
    """Flexion angle and direction for every one-way joint."""
    rows = []
    for label, proximal, joint, distal, fold_sign, limit in hinges:
        if any(n not in arm.pose.bones for n in (proximal, joint, distal)):
            continue
        a, b, c = _segment_dirs(arm, proximal, joint, distal)
        upper = b - a
        lower = c - b
        if upper.length < 1e-6 or lower.length < 1e-6:
            continue
        flexion = math.degrees(upper.angle(lower))

        # Where the far end would be if the joint were straight, and which way
        # it actually went instead. That displacement is the whole test: its
        # sign along her front-back axis says which way the joint folded.
        straight = b + upper.normalized() * lower.length
        travel = (c - straight).dot(ANTERIOR)
        # A nearly straight limb has no fold direction to test -- these bones
        # carry a few degrees of natural bend in the rest pose, and reading a
        # direction out of that noise flags straight arms as hyperextended.
        folded_correctly = flexion < STRAIGHT_ENOUGH or (travel * fold_sign) > 0

        rows.append({
            "joint": label,
            "flexion": flexion,
            "travel": travel,
            "ok_direction": folded_correctly,
            "ok_range": flexion <= limit,
            "limit": limit,
        })
    return rows


def check_balls(arm, balls=BALLS):
    """How far each ball joint has swung from the rest pose."""
    rows = []
    for label, proximal, joint, distal, limit in balls:
        if any(n not in arm.pose.bones for n in (joint, distal)):
            continue
        # Rest direction taken between the SAME two joints the posed vector
        # uses. Taking it from the bone's own head-to-tail instead reported
        # 176 degrees of hip swing on a figure standing at rest, because a
        # VRoid leg bone's tail is not where the next joint is.
        rest = (arm.data.bones[distal].head_local
                - arm.data.bones[joint].head_local)
        now = _local(arm, distal) - _local(arm, joint)
        if rest.length < 1e-6 or now.length < 1e-6:
            continue
        swing = math.degrees(rest.angle(now))
        rows.append({"joint": label, "swing": swing, "limit": limit,
                     "ok_range": swing <= limit})
    return rows


def audit(arm, label=""):
    """Print the whole report and return whether anything is wrong."""
    problems = []
    log(f"--- joint audit {label} ---")
    for row in check_hinges(arm):
        marks = []
        if not row["ok_direction"]:
            marks.append("BENDS BACKWARDS")
        if not row["ok_range"]:
            marks.append(f"PAST THE LIMIT ({row['limit']:.0f})")
        state = "  <-- " + ", ".join(marks) if marks else ""
        log(f"  {row['joint']:<10} flexion {row['flexion']:6.1f} deg   "
            f"far end travels {row['travel']:+.3f} front-back{state}")
        if marks:
            problems.append((row["joint"], marks))
    for row in check_balls(arm):
        state = "" if row["ok_range"] else f"  <-- PAST THE LIMIT ({row['limit']:.0f})"
        log(f"  {row['joint']:<10} swung   {row['swing']:6.1f} deg from rest{state}")
        if not row["ok_range"]:
            problems.append((row["joint"], ["swing past the limit"]))
    if problems:
        log(f"  {len(problems)} joint(s) wrong: "
            + "; ".join(f"{j} ({', '.join(m)})" for j, m in problems))
    else:
        log("  every joint bends the right way, within range")
    return problems
