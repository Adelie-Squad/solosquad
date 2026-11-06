#!/usr/bin/env node
// Placeholder office GLBs — the same node, material, bone, socket and clip names as the asset
// contract (docs/design/office-asset-contract.md), drawn with rounded boxes and a cylinder-ish
// penguin. The web runs on these until the Blender session delivers assets/office/export/;
// swapping them is a file drop. Deterministic: same input, same bytes.
//
//   node scripts/make-office-placeholder.mjs [out-dir]     (default: web/office-placeholder)
//
// Needs Node ≥ 22.18 (it imports the contract and palette .ts files with Node's type stripping).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BONES, CLIPS, LAMP_LIGHT, PENGUIN_MESH, PENGUIN_RIG, ROLE_PROPS, SCARF, SOCKETS, propNode, socketBone } from '../src/office/contract.ts';
import { DAY } from '../src/office/palette.ts';
import { PENGUIN_2D, TEAM_FALLBACK } from '../src/characters/colors.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, '..', 'office-placeholder'));

// ------------------------------------------------------------------ shapes

const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const cyl = (rt, rb, h, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r, ws = 16, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const cone = (r, h, seg = 16) => new THREE.ConeGeometry(r, h, seg);

/** A part: geometry moved into place (position, Euler rotation, scale). */
function part(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  return g;
}

// ------------------------------------------------------------------ gltf-transform helpers

const doc = () => {
  const d = new Document();
  d.createBuffer();
  d.getRoot().getAsset().generator = 'solosquad make-office-placeholder';
  d.getRoot().getAsset().extras = { placeholder: true };
  return d;
};

function materials(d, colours) {
  const map = new Map();
  for (const [name, hex] of Object.entries(colours)) {
    const c = new THREE.Color(hex); // sRGB hex → linear factors, as Blender writes them
    map.set(name, d.createMaterial(name).setBaseColorFactor([c.r, c.g, c.b, 1]).setMetallicFactor(0).setRoughnessFactor(0.9));
  }
  return map;
}

/** One primitive per material (the contract: a module's meshes merged by material). */
function mesh(d, name, byMaterial, mats, skin = null) {
  const m = d.createMesh(name);
  const buffer = d.getRoot().listBuffers()[0];
  for (const [matName, parts] of Object.entries(byMaterial)) {
    if (!parts.length) continue;
    // skinned parts carry their joint as a vertex attribute so welding keeps them apart
    const tagged = parts.map((p) => {
      const g = (p.geo ?? p).clone();
      const j = skin ? skin.indexOf(p.joint) : 0;
      g.setAttribute('joint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(j), 1));
      return g;
    });
    const geo = mergeVertices(mergeGeometries(tagged), 1e-4);
    const prim = d.createPrimitive().setMaterial(mats.get(matName));
    const acc = (type, array) => d.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const n = geo.attributes.position.count;
    prim.setIndices(acc('SCALAR', n > 65535 ? new Uint32Array(geo.index.array) : new Uint16Array(geo.index.array)));
    prim.setAttribute('POSITION', acc('VEC3', new Float32Array(geo.attributes.position.array)));
    prim.setAttribute('NORMAL', acc('VEC3', new Float32Array(geo.attributes.normal.array)));
    prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(geo.attributes.uv.array)));
    if (skin) {
      const joints = new Uint16Array(n * 4);
      const weights = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        joints[i * 4] = geo.attributes.joint.getX(i);
        weights[i * 4] = 1;
      }
      prim.setAttribute('JOINTS_0', acc('VEC4', joints));
      prim.setAttribute('WEIGHTS_0', acc('VEC4', weights));
    }
    m.addPrimitive(prim);
  }
  return m;
}

function track(d, anim, node, path, times, values) {
  const buffer = d.getRoot().listBuffers()[0];
  const sampler = d
    .createAnimationSampler()
    .setInput(d.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer))
    .setOutput(d.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(values.flat())).setBuffer(buffer))
    .setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(d.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
}

const quat = (x = 0, y = 0, z = 0) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
};

async function write(d, file) {
  mkdirSync(out, { recursive: true });
  // quantized attributes (KHR_mesh_quantization — three reads it natively, no decoder, no wasm)
  await d.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }));
  const bytes = await new NodeIO().registerExtensions([KHRMeshQuantization]).writeBinary(d);
  writeFileSync(join(out, file), bytes);
  console.log(`${join(out, file)}  ${(bytes.byteLength / 1024).toFixed(1)} kB`);
}

// ------------------------------------------------------------------ office-kit.glb

async function kit() {
  const d = doc();
  const p = DAY.materials;
  const mats = materials(d, { ...p, team_sticker: TEAM_FALLBACK });
  const scene = d.createScene('office-kit');
  let slot = 0;
  /** A module root, laid out side by side in the file (the web resets position and rotation). */
  const module = (name, byMaterial, children = []) => {
    const n = d.createNode(name).setMesh(mesh(d, name, byMaterial, mats)).setTranslation([(slot++ % 6) * 3, 0, Math.floor(slot / 6) * 3]);
    for (const c of children) n.addChild(c);
    scene.addChild(n);
    return n;
  };
  const empty = (name, t) => d.createNode(name).setTranslation(t);

  module('room.floor_tile', { 'clay.floor': [part(rbox(2, 0.1, 2, 0.035), [0, -0.05, 0])] });
  // walls: the inner face on the module origin, thickness outside the room (−X / −Z)
  module('room.wall_left', { 'clay.wall': [part(rbox(0.12, 2.4, 2, 0.02), [-0.06, 1.2, 0])] });
  module('room.wall_back', { 'clay.wall': [part(rbox(2, 2.4, 0.12, 0.02), [0, 1.2, -0.06])] });
  module('room.corner', { 'clay.wall': [part(rbox(0.14, 2.42, 0.14, 0.03), [-0.07, 1.21, -0.07])] });

  const desk = (name, w) => {
    const top = 0.72;
    const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(rbox(0.05, top - 0.04, 0.05, 0.015), [sx * (w / 2 - 0.06), (top - 0.04) / 2, 0.25 + sz * 0.27])));
    const lid = [0, 0.86, 0.36];
    module(
      name,
      {
        'clay.furniture': [
          part(rbox(w, 0.04, 0.62, 0.02), [0, top - 0.02, 0.25]),
          ...legs,
          // chair: seat, back, stem
          part(rbox(0.5, 0.07, 0.48, 0.03), [0, 0.42, -0.42]),
          part(rbox(0.5, 0.46, 0.06, 0.03), [0, 0.68, -0.66], [-0.08, 0, 0]),
          part(cyl(0.03, 0.03, 0.38), [0, 0.2, -0.42]),
          part(cyl(0.24, 0.24, 0.03, 24), [0, 0.015, -0.42]),
          // laptop base + lid shell
          part(rbox(0.36, 0.02, 0.25, 0.008), [0, top + 0.01, 0.2]),
          part(rbox(0.36, 0.24, 0.014, 0.008), lid, [-0.2, 0, 0]),
        ],
        'clay.wood': [part(rbox(w + 0.02, 0.025, 0.64, 0.01), [0, top - 0.045, 0.25])],
        // the screen faces the sitter (−Z), the sticker faces the camera side (+Z)
        'clay.screen': [part(rbox(0.32, 0.2, 0.004, 0.002), [0, 0.86, 0.352], [-0.2, 0, 0])],
        team_sticker: [part(cyl(0.05, 0.05, 0.004, 24), [0.08, 0.89, 0.37], [Math.PI / 2 - 0.2, 0, 0])],
      },
      [empty(`${name}.seat`, [0, 0.455, -0.42]), empty(`${name}.lamp`, [-(w / 2 - 0.16), top, 0.4])],
    );
  };
  desk('desk.set', 1.2);
  desk('desk.chief', 1.6);

  module(
    'lamp.desk',
    {
      'clay.furniture': [part(cyl(0.07, 0.08, 0.02), [0, 0.01, 0]), part(cyl(0.012, 0.012, 0.36, 8), [0, 0.19, 0]), part(cone(0.08, 0.08, 18), [0.04, 0.37, 0], [0, 0, 0.5])],
      'clay.lamp_bulb': [part(sph(0.035, 12, 8), [0.05, 0.34, 0])],
    },
    [empty(LAMP_LIGHT, [0.05, 0.34, 0])],
  );
  module('prop.plant', {
    'clay.furniture': [part(cyl(0.16, 0.12, 0.32), [0, 0.16, 0])],
    'clay.plant': [part(sph(0.22), [0, 0.5, 0], [0, 0, 0], [1, 1.25, 1]), part(sph(0.15), [0.12, 0.72, 0.04])],
  });
  module('prop.shelf', {
    'clay.furniture': [part(rbox(1.4, 0.8, 0.4, 0.03), [0, 0.4, 0])],
    'clay.wood': [part(rbox(1.42, 0.04, 0.42, 0.015), [0, 0.82, 0]), part(rbox(0.3, 0.22, 0.2), [-0.35, 0.95, 0]), part(rbox(0.22, 0.3, 0.2), [0.3, 0.99, 0])],
  });
  module('prop.whiteboard', {
    'clay.furniture': [part(rbox(1.5, 0.95, 0.05, 0.02), [0, 1.35, 0]), part(rbox(0.05, 0.9, 0.05), [-0.6, 0.45, 0]), part(rbox(0.05, 0.9, 0.05), [0.6, 0.45, 0])],
    'clay.wood': [part(rbox(1.56, 0.04, 0.08, 0.015), [0, 0.86, 0.02])],
  });
  module('prop.sofa', {
    'clay.furniture': [part(rbox(1.7, 0.4, 0.8, 0.08), [0, 0.2, 0]), part(rbox(1.7, 0.45, 0.2, 0.08), [0, 0.55, -0.3]), part(rbox(0.2, 0.55, 0.8, 0.08), [-0.75, 0.3, 0]), part(rbox(0.2, 0.55, 0.8, 0.08), [0.75, 0.3, 0])],
  });
  module('prop.coffee_bar', {
    'clay.wood': [part(rbox(1.3, 0.9, 0.55, 0.03), [0, 0.45, 0])],
    'clay.furniture': [part(rbox(1.34, 0.04, 0.58, 0.015), [0, 0.92, 0]), part(rbox(0.3, 0.38, 0.3, 0.04), [-0.3, 1.13, -0.05])],
  });
  await write(d, 'office-kit.glb');
}

// ------------------------------------------------------------------ penguin.glb

async function penguin() {
  const d = doc();
  const mats = materials(d, {
    'penguin.body': PENGUIN_2D.body,
    'penguin.face': PENGUIN_2D.face,
    'penguin.cheek': '#E01FAE', // --cheek
    'penguin.eye': PENGUIN_2D.eye,
    'penguin.beak': PENGUIN_2D.beak,
    'penguin.feet': PENGUIN_2D.beak,
    team_accent: TEAM_FALLBACK,
    'prop.gold': PENGUIN_2D.gold,
    'prop.black': PENGUIN_2D.eye,
    'prop.white': PENGUIN_2D.paper,
    'prop.metal': PENGUIN_2D.metal,
    'prop.lens': PENGUIN_2D.lens,
  });
  const scene = d.createScene('penguin');

  // bones at rest (world positions; the penguin sits on its seat, origin = seat surface, faces +Z)
  const world = {
    root: [0, 0, 0],
    body: [0, 0.12, 0],
    head: [0, 0.3, 0],
    'wing.L': [0.2, 0.3, 0],
    'wing.R': [-0.2, 0.3, 0],
    'foot.L': [0.08, 0.02, 0.1],
    'foot.R': [-0.08, 0.02, 0.1],
    [socketBone('head')]: [0, 0.52, 0],
    [socketBone('chest')]: [0, 0.22, 0.19],
    [socketBone('hand.R')]: [-0.25, 0.12, 0.06],
  };
  const parent = {
    body: 'root',
    head: 'body',
    'wing.L': 'body',
    'wing.R': 'body',
    'foot.L': 'root',
    'foot.R': 'root',
    [socketBone('head')]: 'head',
    [socketBone('chest')]: 'body',
    [socketBone('hand.R')]: 'wing.R',
  };
  const jointNames = [...BONES, ...SOCKETS.map(socketBone)];
  const nodes = new Map();
  for (const name of jointNames) {
    const w = world[name];
    const pw = parent[name] ? world[parent[name]] : [0, 0, 0];
    nodes.set(name, d.createNode(name).setTranslation([w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]]));
  }
  for (const [child, par] of Object.entries(parent)) nodes.get(par).addChild(nodes.get(child));
  const rig = d.createNode(PENGUIN_RIG).addChild(nodes.get('root'));
  scene.addChild(rig);

  const buffer = d.getRoot().listBuffers()[0];
  const ibm = new Float32Array(jointNames.length * 16);
  jointNames.forEach((n, i) => {
    const [x, y, z] = world[n];
    ibm.set(new THREE.Matrix4().makeTranslation(-x, -y, -z).elements, i * 16);
  });
  const skin = d.createSkin('penguin_rig').setInverseBindMatrices(d.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  for (const n of jointNames) skin.addJoint(nodes.get(n));
  skin.setSkeleton(nodes.get('root'));

  const j = (joint, geo) => ({ joint, geo });
  const body = mesh(
    d,
    PENGUIN_MESH,
    {
      'penguin.body': [
        j('body', part(cyl(0.17, 0.21, 0.3, 28), [0, 0.15, 0])),
        j('head', part(sph(0.19, 28, 18), [0, 0.36, 0], [0, 0, 0], [1, 0.82, 0.92])),
        j('wing.L', part(sph(0.09), [0.22, 0.2, 0], [0, 0, 0.25], [0.35, 1, 0.6])),
        j('wing.R', part(sph(0.09), [-0.22, 0.2, 0], [0, 0, -0.25], [0.35, 1, 0.6])),
      ],
      'penguin.face': [j('head', part(sph(0.15, 24, 16), [0, 0.32, 0.09], [0, 0, 0], [1, 0.9, 0.7])), j('body', part(sph(0.15, 24, 16), [0, 0.13, 0.1], [0, 0, 0], [0.95, 1.1, 0.6]))],
      'penguin.eye': [j('head', part(sph(0.025), [0.065, 0.38, 0.185], [0, 0, 0], [0.9, 1.2, 0.5])), j('head', part(sph(0.025), [-0.065, 0.38, 0.185], [0, 0, 0], [0.9, 1.2, 0.5]))],
      'penguin.cheek': [j('head', part(sph(0.03), [0.11, 0.33, 0.17], [0, 0, 0], [1.2, 0.8, 0.4])), j('head', part(sph(0.03), [-0.11, 0.33, 0.17], [0, 0, 0], [1.2, 0.8, 0.4]))],
      'penguin.beak': [j('head', part(cone(0.03, 0.06, 12), [0, 0.34, 0.215], [Math.PI / 2, 0, 0]))],
      'penguin.feet': [j('foot.L', part(sph(0.05), [0.08, 0.02, 0.12], [0, 0, 0], [1, 0.4, 1.5])), j('foot.R', part(sph(0.05), [-0.08, 0.02, 0.12], [0, 0, 0], [1, 0.4, 1.5]))],
    },
    mats,
    jointNames,
  );
  rig.addChild(d.createNode(PENGUIN_MESH).setMesh(body).setSkin(skin));

  // role props — rigid meshes at their rest place, `socket` names the bone the web hangs them on
  const H = world[socketBone('head')];
  const C = world[socketBone('chest')];
  const R = world[socketBone('hand.R')];
  const at = (base, dx = 0, dy = 0, dz = 0) => [base[0] + dx, base[1] + dy, base[2] + dz];
  const glasses = (mat) => ({ [mat]: [part(cyl(0.035, 0.035, 0.012, 16), at(H, 0.065, -0.14, 0.17), [Math.PI / 2, 0, 0]), part(cyl(0.035, 0.035, 0.012, 16), at(H, -0.065, -0.14, 0.17), [Math.PI / 2, 0, 0])], 'prop.black': [part(rbox(0.06, 0.01, 0.01, 0.004), at(H, 0, -0.14, 0.175))] });
  const shapes = {
    'chief.crown': ['head', { 'prop.gold': [part(cyl(0.08, 0.09, 0.07, 10), at(H, 0, 0.0, 0)), part(cone(0.02, 0.04, 6), at(H, 0, 0.055, 0.06))] }],
    'chief.bowtie': ['chest', { team_accent: [part(cone(0.03, 0.05, 4), at(C, -0.025, 0, 0.01), [0, 0, -Math.PI / 2]), part(cone(0.03, 0.05, 4), at(C, 0.025, 0, 0.01), [0, 0, Math.PI / 2])] }],
    'product-manager.clipboard': ['hand.R', { 'prop.white': [part(rbox(0.12, 0.16, 0.015, 0.005), at(R, 0, 0.03, 0.03))], team_accent: [part(rbox(0.05, 0.02, 0.02, 0.005), at(R, 0, 0.11, 0.035))] }],
    'product-designer.beret': ['head', { team_accent: [part(cyl(0.13, 0.15, 0.04, 20), at(H, 0.02, -0.01, -0.01), [0.1, 0, -0.15])] }],
    'researcher.glasses': ['head', glasses('prop.lens')],
    'data-analyst.chart': ['hand.R', { 'prop.white': [part(rbox(0.14, 0.12, 0.012, 0.004), at(R, 0, 0.04, 0.03))], team_accent: [part(rbox(0.02, 0.06, 0.01), at(R, -0.03, 0.03, 0.04)), part(rbox(0.02, 0.09, 0.01), at(R, 0.01, 0.045, 0.04))] }],
    'frontend-engineer.beanie': ['head', { team_accent: [part(sph(0.15, 20, 10), at(H, 0, -0.06, -0.01), [0, 0, 0], [1, 0.6, 1]), part(sph(0.03), at(H, 0, 0.04, -0.01))] }],
    'backend-engineer.headset': ['head', { 'prop.black': [part(cyl(0.16, 0.16, 0.02, 20, 1), at(H, 0, -0.08, 0), [0, 0, Math.PI / 2], [1, 1, 0.25])], team_accent: [part(cyl(0.04, 0.04, 0.03, 12), at(H, 0.18, -0.15, 0), [0, 0, Math.PI / 2]), part(cyl(0.04, 0.04, 0.03, 12), at(H, -0.18, -0.15, 0), [0, 0, Math.PI / 2])] }],
    'data-engineer.cube': ['hand.R', { team_accent: [part(rbox(0.09, 0.09, 0.09, 0.015), at(R, 0, 0.05, 0.03))] }],
    'infra.hardhat': ['head', { 'prop.gold': [part(sph(0.15, 20, 10, 0), at(H, 0, -0.05, 0), [0, 0, 0], [1, 0.65, 1]), part(cyl(0.18, 0.18, 0.015, 20), at(H, 0, -0.06, 0.02))] }],
    'infra.shield': ['chest', { team_accent: [part(rbox(0.07, 0.08, 0.015, 0.02), at(C, 0.06, 0.02, 0.01))] }],
    'quality-assurance.magnifier': ['hand.R', { 'prop.metal': [part(cyl(0.05, 0.05, 0.015, 20), at(R, 0, 0.08, 0.04), [Math.PI / 2, 0, 0])], 'prop.black': [part(cyl(0.01, 0.01, 0.08, 8), at(R, 0, 0.01, 0.04))] }],
    'business-strategy.tie': ['chest', { team_accent: [part(cone(0.03, 0.14, 4), at(C, 0, -0.06, 0.012), [Math.PI, 0, 0])] }],
    'sales.card': ['hand.R', { 'prop.white': [part(rbox(0.09, 0.055, 0.006, 0.003), at(R, 0, 0.05, 0.04))], team_accent: [part(rbox(0.03, 0.01, 0.007), at(R, -0.02, 0.06, 0.044))] }],
    'finance.glasses': ['head', glasses('prop.gold')],
    'finance.calculator': ['hand.R', { 'prop.black': [part(rbox(0.08, 0.12, 0.02, 0.008), at(R, 0, 0.05, 0.03))], 'prop.white': [part(rbox(0.06, 0.03, 0.005), at(R, 0, 0.08, 0.042))] }],
    'marketer.megaphone': ['hand.R', { team_accent: [part(cyl(0.06, 0.025, 0.14, 16), at(R, 0, 0.06, 0.08), [Math.PI / 2, 0, 0])] }],
    'creative.brush': ['hand.R', { 'prop.black': [part(cyl(0.01, 0.01, 0.14, 8), at(R, 0, 0.06, 0.04), [0.4, 0, 0])], team_accent: [part(cone(0.02, 0.05, 10), at(R, 0, 0.14, 0.075), [0.4, 0, 0])] }],
  };
  const addProp = (name, socket, byMaterial) => {
    const n = d.createNode(name).setMesh(mesh(d, name, byMaterial, mats)).setExtras({ socket });
    scene.addChild(n);
  };
  for (const [agent, parts] of Object.entries(ROLE_PROPS)) {
    for (const p of parts) {
      const [socket, byMaterial] = shapes[`${agent}.${p}`];
      addProp(propNode(agent, p), socket, byMaterial);
    }
  }
  addProp(SCARF, 'chest', { team_accent: [part(new THREE.TorusGeometry(0.15, 0.035, 10, 28), at(C, 0, 0.04, -0.17), [Math.PI / 2 - 0.15, 0, 0], [1, 1, 0.8]), part(rbox(0.06, 0.12, 0.025, 0.012), at(C, 0.07, -0.04, 0))] });

  // clips — 30 fps keys, the loop's first key = its last; the first frame is the state's still pose
  const N = (n) => nodes.get(n);
  const keys = (seconds, fn) => {
    const steps = Math.round(seconds * 30);
    const times = [];
    const values = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      times.push((i / 30));
      values.push(fn(Math.sin(t * Math.PI * 2), t));
    }
    return [times, values];
  };
  const clip = (name, seconds, channels) => {
    const a = d.createAnimation(name);
    for (const [bone, path, fn] of channels) track(d, a, N(bone), path, ...keys(seconds, fn));
  };
  const rest = (b) => {
    const w = world[b];
    const p = parent[b] ? world[parent[b]] : [0, 0, 0];
    return [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
  };
  const lift = (b, dy) => {
    const r = rest(b);
    return [r[0], r[1] + dy, r[2]];
  };
  const s01 = (s) => (s + 1) / 2;
  clip('idle', 2, [
    ['body', 'scale', (s) => [1 + 0.015 * s, 1 - 0.02 * s, 1 + 0.015 * s]],
    ['head', 'rotation', (s) => quat(0.03 * s, 0, 0)],
  ]);
  clip('idle_doze', 2, [
    ['head', 'rotation', (s) => quat(0.18 + 0.16 * s, 0, 0.05)],
    ['body', 'rotation', (s) => quat(0.06 + 0.03 * s, 0, 0)],
  ]);
  clip('thinking', 2, [
    ['body', 'rotation', (s) => quat(0, 0, 0.08 * s)],
    ['head', 'rotation', (s) => quat(-0.18, 0.1 * s, 0)],
    ['wing.R', 'rotation', () => quat(-0.9, 0, -0.5)],
  ]);
  clip('typing', 1, [
    ['body', 'rotation', () => quat(0.16, 0, 0)],
    ['wing.L', 'rotation', (s) => quat(-1.1 - 0.25 * s, 0, 0.15)],
    ['wing.R', 'rotation', (s) => quat(-1.1 + 0.25 * s, 0, -0.15)],
  ]);
  clip('waiting', 1, [
    ['wing.R', 'rotation', (s) => quat(0, 0, -2.6 + 0.25 * s)],
    ['root', 'translation', (s, t) => lift('root', 0.03 * Math.abs(Math.sin(t * Math.PI * 2)))],
  ]);
  clip('done', 1, [
    ['wing.L', 'rotation', (s) => quat(0, 0, 2.3 + 0.2 * s)],
    ['wing.R', 'rotation', (s) => quat(0, 0, -2.3 - 0.2 * s)],
    ['root', 'translation', (s, t) => lift('root', 0.09 * Math.sin(t * Math.PI))],
    ['body', 'scale', (s, t) => {
      const squash = Math.max(0, Math.cos(t * Math.PI * 2)) * 0.06;
      return [1 + squash * 0.6, 1 - squash, 1 + squash * 0.6];
    }],
  ]);
  clip('error', 2, [
    ['head', 'rotation', (s) => quat(0.42 + 0.02 * s01(s), 0, 0)],
    ['body', 'rotation', () => quat(0.18, 0, 0)],
    ['wing.L', 'rotation', () => quat(0, 0, -0.1)],
    ['wing.R', 'rotation', () => quat(0, 0, 0.1)],
  ]);
  if (d.getRoot().listAnimations().length !== CLIPS.length) throw new Error('clip list out of step with the contract');
  await write(d, 'penguin.glb');
}

await kit();
await penguin();
