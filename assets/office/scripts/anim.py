"""State clips (contract §6): one action per state id, 30 fps, seamless 1–2 s loops.

Every channel is a sum of sines over the clip length, with an integer number of cycles, so
the first frame equals the last. Frame 0 is the representative pose for the state (the web
shows it under prefers-reduced-motion): each wave starts at its phase where it adds nothing
to the base pose in `penguin.POSES`, except where noted.

Bone-local conventions (see penguin.py): body/head X- = lean forward, wing X- = swing
forward, wing outward = L Z- / R Z+; body location Y = up.
"""
import math

import bpy

import penguin

FPS = 30

# state -> (length in frames, {channel: [(amplitude, cycles, phase), ...]})
# channel = "<bone>:rot:<axis 0-2>" in degrees, "<bone>:loc:<axis>" in metres,
#           "<bone>:scl:<axis>" as a factor offset from 1.
CLIPS = {
    'idle': (60, {
        'body:scl:1': [(0.025, 1, 0)],            # slow breath, body taller
        'body:scl:0': [(-0.012, 1, 0)],
        'head:rot:0': [(2.0, 1, 0)],
    }),
    'idle_doze': (60, {
        'head:rot:0': [(-5.0, 1, 0)],             # nodding a little lower
        'body:rot:0': [(-1.5, 1, 0)],
        'body:scl:1': [(0.02, 1, 0)],
        'body:scl:0': [(-0.01, 1, 0)],
    }),
    'thinking': (60, {
        'body:rot:2': [(5.0, 1, math.pi / 2)],    # sway side to side (frame 0 = base tilt +5)
        'head:rot:1': [(8.0, 1, 0)],              # look around while looking up
        'wing.R:rot:0': [(4.0, 2, 0)],            # tapping the chin
    }),
    'typing': (30, {
        'wing.L:rot:0': [(9.0, 3, 0)],            # alternate wings, three taps per second
        'wing.R:rot:0': [(9.0, 3, math.pi)],
        'body:loc:1': [(0.004, 6, 0)],
        'head:rot:0': [(1.5, 3, 0)],
    }),
    'waiting': (30, {
        'wing.R:rot:0': [(18.0, 2, 0)],           # wave the raised wing
        'body:loc:1': [(0.018, 2, -math.pi / 2), (0.018, 0, 0)],  # small hops (>= 0)
    }),
    'done': (30, {
        'body:loc:1': [(0.05, 1, -math.pi / 2), (0.05, 0, 0)],    # one jump per loop
        'wing.L:rot:2': [(-12.0, 2, 0)],
        'wing.R:rot:2': [(12.0, 2, 0)],
    }),
    'error': (60, {
        'head:rot:0': [(-1.5, 1, 0)],             # still, heavy breathing
        'body:scl:1': [(0.012, 1, 0)],
    }),
}


def _wave(terms, t, length):
    v = 0.0
    for amp, cycles, phase in terms:
        if cycles == 0:
            v += amp
        else:
            v += amp * math.sin(math.tau * cycles * t / length + phase)
    return v


def _squash(state, t, length):
    """Landing squash for `done`: shorter and wider while near the ground."""
    if state != 'done':
        return 0.0
    h = 0.5 * (1 + math.sin(math.tau * t / length - math.pi / 2))   # 0 on the ground
    return 0.08 * max(0.0, 1 - h * 4) ** 2


def build_actions(rig_ob):
    """Create one action per state on rig_ob; returns {state: action}."""
    scene = bpy.context.scene
    scene.render.fps = FPS
    rig_ob.animation_data_create()
    out = {}
    for state, (length, chans) in CLIPS.items():
        name = state
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig_ob.animation_data.action = act
        base = penguin.POSES.get(state, {})
        for f in range(length + 1):
            penguin.apply_pose(rig_ob, state)
            for key, terms in chans.items():
                bone, kind, axis = key.split(':')
                pb = rig_ob.pose.bones[bone]
                v = _wave(terms, f, length)
                axis = int(axis)
                if kind == 'rot':
                    e = list(pb.rotation_euler)
                    e[axis] += math.radians(v)
                    pb.rotation_euler = e
                elif kind == 'loc':
                    l = list(pb.location)
                    l[axis] += v
                    pb.location = l
                else:
                    s = list(pb.scale)
                    s[axis] += v
                    pb.scale = s
            sq = _squash(state, f, length)
            if sq:
                b = rig_ob.pose.bones['body']
                b.scale = (b.scale[0] + sq * 0.6, b.scale[1] - sq, b.scale[2] + sq * 0.6)
            for pb in rig_ob.pose.bones:
                if pb.name.startswith('socket.'):
                    continue
                pb.keyframe_insert('rotation_euler', frame=f)
                pb.keyframe_insert('location', frame=f)
                pb.keyframe_insert('scale', frame=f)
        act.frame_range = (0, length)
        act.use_frame_range = True
        act.use_cyclic = True
        for fc in _fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        # park it on an NLA track so the exporter sees every clip
        track = rig_ob.animation_data.nla_tracks.new()
        track.name = state
        strip = track.strips.new(state, 0, act)
        track.mute = True
        out[state] = act
    rig_ob.animation_data.action = None
    penguin.apply_pose(rig_ob, 'idle')
    for b in rig_ob.pose.bones:
        b.scale = (1, 1, 1)
    return out


def _fcurves(act):
    """F-curves of an action (Blender 4.4+ layered actions, with fallback)."""
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])):
        return list(act.fcurves)
    curves = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                curves.extend(bag.fcurves)
    return curves
