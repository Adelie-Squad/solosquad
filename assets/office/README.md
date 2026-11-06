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
$B -b -P assets/office/scripts/export.py        -- --out  assets/office/export   # office-kit.glb + penguin.glb
python3 assets/office/scripts/check_glb.py assets/office/export                  # contract check, exits 1 on failure
```

`export.py` builds everything from scratch (it does not read `src/*.blend`), bakes AO in Cycles,
exports GLB with WebP textures and custom properties as extras, then runs
`npx -y @gltf-transform/cli@4.5.1 meshopt` (the same version the web pins). It needs Node for that
step; `--no-meshopt` skips it and `--keep-ao` also writes the baked AO PNGs (gitignored) for
inspection.

| Script | What it builds |
|---|---|
| `lib.py` | Palette (material name = palette key), matte clay materials, bmesh helpers |
| `kit.py` | `room.*` · `desk.set` · `desk.chief` · `lamp.desk` (+ `lamp.desk.light`) · `prop.plant/shelf/whiteboard/sofa/coffee_bar` |
| `penguin.py` | Mesh `penguin` (body · heart felt face · stitch · eyes · cheeks · beak · wings · feet), rig `penguin_rig`, state key poses `POSES` |
| `props.py` | 19 role-prop meshes `prop.<agent-id>.<part>` + `prop.scarf`, with custom property `socket` |
| `frames.py` | Style frames: 2×2-tile room, 4 penguins, ortho 30°/45°, light and evening, Cycles |
| `anim.py` | The 7 state clips as actions + NLA tracks (sums of whole-cycle sines, so frame 0 = last frame) |
| `export.py` | Per-module materials `<key>#<module>`, `uv_main` + `uv_ao`, AO bake, GLB export, meshopt |
| `check_glb.py` | Checks names, sockets, clips, materials (metallic 0, roughness ≥ 0.8), AO texCoord 1, WebP, 5 MB |

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
- **Triangle counts** (measured, as exported) against the contract §8 budget. All are within it.

  | Item | Triangles | Budget |
  |---|---|---|
  | `penguin` | 6,546 | 8k |
  | `desk.set` / `desk.chief` | 2,636 | 3k |
  | `lamp.desk` | 1,228 | 2k |
  | `prop.sofa` / `prop.plant` / `prop.shelf` | 1,880 / 1,804 / 1,664 | 2k |
  | `prop.coffee_bar` / `prop.whiteboard` | 1,428 / 624 | 2k |
  | `room.*` | 12 to 36 | 500 |
  | Role props | 156 (shield) to 780 (hardhat) | 800 |

## Exported files

| File | Size (meshopt) | Contents |
|---|---|---|
| `export/office-kit.glb` | 651 KB | 12 module roots; 29 materials `<key>#<module>`; 8 AO maps `<module>_ao` (WebP; 1024 px for desks, sofa and shelf, 512 for coffee bar, plant and whiteboard, 256 for the lamp) |
| `export/penguin.glb` | 185 KB | Skinned `penguin` + `penguin_rig` (10 joints); 19 props parented to socket bones with extras `socket`; 7 clips |
| **Total** | **817 KB** | Budget 5 MB |

- **Kit materials** are per module, named `<palette key>#<module>` (contract §4, PR #57): for
  example `clay.furniture#desk.set` and `team_sticker#desk.chief`. Match the palette key with
  `name.split('#')[0]`. Each one has `occlusionTexture` with `texCoord: 1` (`uv_ao`), metallic 0
  and roughness 0.9. `room.*` pieces have no AO map, because a lone slab or wall bakes to plain
  white.
- **meshopt quantization** may move a module's mesh onto an unnamed child node that carries the
  dequantization transform (for example under `lamp.desk`). Find modules by root name, not by mesh
  node.
- **Penguin and prop materials** keep bare keys (`penguin.body`, `team_accent`, `prop.gold` and so
  on). The wooden parts of the clipboard and brush use `prop.wood` (`#D8C3A2`, fixed: the web
  does not re-tint it per theme).
- **No glTF extensions** beyond meshopt, quantization and WebP: specular is left at the glTF
  default, so `KHR_materials_specular` is not emitted.
- **Clips** (30 fps, frame 0 = the pose that stands for the state, last frame = frame 0):

  | Clip | Length | Motion |
  |---|---|---|
  | `idle` | 2 s | slow breath, slight head bob |
  | `idle_doze` | 2 s | head bowed, nodding, slow breath |
  | `thinking` | 2 s | looks up, sways side to side, right wing tapping the chin |
  | `typing` | 1 s | leans in, wings alternate on the desk 3× per second |
  | `waiting` | 1 s | right wing raised and waving, two small hops |
  | `done` | 1 s | both wings up, one jump with a squash on landing |
  | `error` | 2 s | head down, nearly still, heavy breath |

## Measured palette (style frames, sRGB)

Measured by `frames.py` (`PROBES`). Each value averages a 7×7 px window around a 3D point projected
through the camera. Under the Standard view transform, the light frame lands near the material
values; the evening frame is lit only by lamps, screens and a weak blue sky, so it is much darker
than the material colours.

| Key | Material (light) | Rendered light | Material (evening) | Rendered evening |
|---|---|---|---|---|
| `clay.backdrop` | `#EEE9DF` | `#EEE9DF` | `#15161B` | `#15161B` |
| `clay.wall` (lit back wall) | `#F4F1EA` | `#F1EADD` | `#2B2D37` | `#100E13` |
| `clay.wall` (left wall, shade side) | `#F4F1EA` | `#CFCBC1` | `#2B2D37` | `#1F212F` |
| `clay.floor` | `#ECE7DE` | `#F0E8DA` | `#23252E` | `#1E2436` (moon rim) |
| `clay.furniture` (desk top) | `#F7F5F0` | `#FFFBF0` | `#3A3C47` | `#625863` (lamp-lit) |
| `clay.wood` (coffee bar top) | `#D8C3A2` | `#A69275` (in shade) | `#5A4E3E` | `#1A120D` |
| `clay.plant` | `#8DB36B` | `#8DB06C` | `#4E6A3A` | `#273B34` |
| `clay.screen` | `#2C74E0` | — | base `#1B2A4A` + emission `#8FB8FF` ×2.2 | — |
| `clay.lamp_bulb` | `#FFF4DE` (off) | — | `#FFC56B` emission ×12 | — |
| `penguin.body` | `#2B2A26` | — | **`#474855`** (new: lifted so the silhouette reads at night) | — |

Lighting: light = sky `#FFFFFF` ×0.72 plus a sun `#FFF6E8` ×1.5 with a 14° angle; evening = sky
`#3A4566` ×0.9, a cool moon rim sun `#9FB2E8` ×2.5 from behind and above (it outlines heads,
shoulders and props but not faces), lamp points `#FFC56B` 18 W, and screen area lights `#8FB8FF`
14 W facing the agent. Lamps and screens are switched **per agent**: off for `idle` / `idle_doze`.
Measured face centres in the evening frame: working agents `#E8BB9F` to `#FFF3C8`; the dozing
agent `#5F5C6D`. No material emits on the face; the dozing face is lit only by ambient and spill.

Fixed colours outside the DESIGN table: `penguin.face` `#F3F0EA` · `penguin.cheek` `#E01FAE` ·
`penguin.eye` `#151410` · `penguin.beak` / `penguin.feet` `#F0AE5E` · `penguin.stitch` `#8E8676`
(the 2D icon values, `web/src/characters/colors.ts`) · `prop.gold` `#C9A227` · `prop.black`
`#2B2A26` · `prop.paper` `#F4F1EA` · `prop.metal` `#8A8371` · `prop.lens` `#C9DDF6` ·
`prop.helmet` `#F0C640` · `prop.wood` `#D8C3A2`.

## Style frames

`frames/style-light.png` and `frames/style-evening.png` (1600×1200, Cycles at 192 samples, denoised).
Room = 2×2 tiles. States:

| Agent | Light | Evening |
|---|---|---|
| chief (core · crown + bow tie) | thinking | typing (lamp on) |
| product-manager (product · clipboard) | typing | thinking (lamp on) |
| frontend-engineer (engineering · beanie) | waiting (wing raised) | waiting (lamp on) |
| marketer (brand · megaphone) | done (both wings up) | idle_doze (lamp and screen off) |
