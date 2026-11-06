# Office 3D assets

Clay isometric office for the web office scene. The spec is
[`docs/design/office-asset-contract.md`](../../docs/design/office-asset-contract.md), and the
art direction is DESIGN.md `## 사무실 장면` v3. **The source of truth is `scripts/`**: every
shape, material and pose is built by Blender Python from an empty scene. `src/*.blend` is a
build output, gitignored, and no downloaded models, textures or HDRIs are used.

## Rebuilding (Blender 5.2, no GUI)

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b -P assets/office/scripts/build_kit.py     -- --save assets/office/src/office-kit.blend
$B -b -P assets/office/scripts/build_penguin.py -- --save assets/office/src/penguin.blend
$B -b -P assets/office/scripts/frames.py        -- --out  assets/office/frames   # style frames + palette measurement
```

`export.py` (GLB + meshopt + WebP) comes in the next stage, after the style frames are approved.

| Script | What it builds |
|---|---|
| `lib.py` | Palette (material name = palette key), matte clay materials, bmesh helpers |
| `kit.py` | `room.*` · `desk.set` · `desk.chief` · `lamp.desk` (+ `lamp.desk.light`) · `prop.plant/shelf/whiteboard/sofa/coffee_bar` |
| `penguin.py` | Mesh `penguin` (body · heart felt face · stitch · eyes · cheeks · beak · wings · feet), rig `penguin_rig`, state key poses `POSES` |
| `props.py` | 19 role-prop meshes `prop.<agent-id>.<part>` + `prop.scarf`, with custom property `socket` |
| `frames.py` | Style frames: 2×2-tile room, 4 penguins, ortho 30°/45°, light and evening, Cycles |

## Conventions (as built)

- **Axes**: Blender Z-up. glTF +Z (the open front, the way a seated agent faces) = Blender −Y.
  Walls are on Blender −X (left) and +Y (back).
- **Module origin** = centre of the floor face it stands on. **Wall pieces use the centre of the
  2×2 m tile they border**: place `room.wall_left` / `room.wall_back` / `room.corner` at the same
  position as their `room.floor_tile`. The wall then sits outside that tile's −X or back edge.
  Floor tiles have square edges and walls are rounded only along the top, so tiles butt together
  without seams.
- **Desk set**: the desk is in front of the agent (−Y), the chair behind (+Y). The penguin sits at
  local (0, +0.27, 0.42) on `desk.set` and `desk.chief` (seat height 0.42 m, desk top 0.72 m).
  The laptop lid's back, with the `team_sticker` disc, faces the camera.
- **Desk lamp**: stands on the desk's back-left corner, at desk-local (−w/2 + 0.12, −0.02, 0.72)
  with w = 0.96 for `desk.set` and 1.30 for `desk.chief`. The light position is the child empty
  `lamp.desk.light`.
- **Penguin**: seated height 0.60 m (the contract says about 0.55; raised so the face clears the
  laptop lid at 30°), width 0.53 m, depth 0.33 m. Its right side is −X.
- **Rig bones**: `root` · `body` · `head` · `wing.L` · `wing.R` · `foot.L` · `foot.R`, plus the
  non-deforming sockets `socket.head` · `socket.chest` · `socket.hand.R`. Bone-local rotations:
  head and body X− lean forward, wing X− swings forward, and wings rise outward on Z− (L) or
  Z+ (R).
- **Triangle counts** (measured) against the contract §8 budget. Items marked over are trimmed
  in the kit stage:

  | Item | Triangles | Budget |
  |---|---|---|
  | `penguin` | 12,260 | 8k, **over** |
  | `desk.set` / `desk.chief` | 2,636 | 3k |
  | `lamp.desk` | 1,228 | 2k |
  | `prop.plant` / `prop.sofa` / `prop.shelf` | 3,228 / 2,552 / 2,384 | 2k, **over** |
  | `prop.coffee_bar` / `prop.whiteboard` | 1,428 / 624 | 2k |
  | `room.*` | 12 to 36 | 500 |
  | Role props | under 800, apart from headset 860 / hardhat 828 / beanie 820 | 800, **slightly over** |

## Measured palette (style frames, sRGB)

Measured by `frames.py` (`PROBES`). Each value averages a 7×7 px window around a 3D point projected
through the camera. Under the Standard view transform, the light frame lands near the material
values; the evening frame is lit only by lamps, screens and a weak blue sky, so it is much darker
than the material colours.

| Key | Material (light) | Rendered light | Material (evening) | Rendered evening |
|---|---|---|---|---|
| `clay.backdrop` | `#EEE9DF` | `#EEE9DF` | `#15161B` | `#15161B` |
| `clay.wall` (lit back wall) | `#F4F1EA` | `#F1EADD` | `#2B2D37` | `#11111D` |
| `clay.wall` (left wall, shade side) | `#F4F1EA` | `#CFCBC1` | `#2B2D37` | `#1C1E2F` |
| `clay.floor` | `#ECE7DE` | `#F0E8D9` | `#23252E` | `#080C1A` |
| `clay.furniture` (desk top) | `#F7F5F0` | `#FFFBF0` | `#3A3C47` | `#53484E` (lamp-lit) |
| `clay.wood` (coffee bar top) | `#D8C3A2` | `#A59173` (in shade) | `#5A4E3E` | `#1D1616` |
| `clay.plant` | `#8DB36B` | `#8CAF69` | `#4E6A3A` | `#172923` |
| `clay.screen` | `#2C74E0` | — | base `#1B2A4A` + emission `#8FB8FF` ×2.2 | — |
| `clay.lamp_bulb` | `#FFF4DE` (off) | — | `#FFC56B` emission ×12 | — |
| `penguin.body` | `#2B2A26` | — | **`#474855`** (new: lifted so the silhouette reads at night) | — |

Lighting: light = sky `#FFFFFF` ×0.72 plus a sun `#FFF6E8` ×1.5 with a 14° angle; evening = sky
`#3A4566` ×2.4, lamp points `#FFC56B` 18 W, screen area lights `#8FB8FF` 14 W facing the agent.
Lamps and screens are switched **per agent**: off for `idle` / `idle_doze`.

Fixed colours outside the DESIGN table: `penguin.face` `#F3F0EA` · `penguin.cheek` `#E01FAE` ·
`penguin.eye` `#151410` · `penguin.beak` / `penguin.feet` `#F0AE5E` · `penguin.stitch` `#8E8676`
(the 2D icon values, `web/src/characters/colors.ts`) · `prop.gold` `#C9A227` · `prop.black`
`#2B2A26` · `prop.paper` `#F4F1EA` · `prop.metal` `#8A8371` · `prop.lens` `#C9DDF6` ·
`prop.helmet` `#F0C640`.

## Style frames

`frames/style-light.png` and `frames/style-evening.png` (1600×1200, Cycles at 192 samples, denoised).
Room = 2×2 tiles. States:

| Agent | Light | Evening |
|---|---|---|
| chief (core · crown + bow tie) | thinking | typing (lamp on) |
| product-manager (product · clipboard) | typing | thinking (lamp on) |
| frontend-engineer (engineering · beanie) | waiting (wing raised) | waiting (lamp on) |
| marketer (brand · megaphone) | done (both wings up) | idle_doze (lamp and screen off) |
