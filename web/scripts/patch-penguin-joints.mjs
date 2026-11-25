// Patches the penguin's joint fillets (penguin.joint.L/R) in a freshly exported penguin.glb with
// their exact normals — the build step after Blender's glTF export, before meshopt
// (assets/office/scripts/penguin_prod.py `export_glb`). Not part of the app build.
//
//   node web/scripts/patch-penguin-joints.mjs <penguin.glb> <joint-normals.json>
//
// The JSON (written by penguin_prod.py, glTF axes): per joint object, its basis vertex positions and
// the exact normal of every vertex in every shape key (`Basis` + `welt.<raise>.<twist>`). Blender's
// exporter writes face-averaged normals (and morph normal deltas) from the coarse fillet mesh, so
// the fillet's shading broke where it meets the body; the exact ones match the body's own normals.
// Vertices are matched by their basis position (the exporter splits and reorders them).
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [file, jsonPath] = process.argv.slice(2);
if (!file || !jsonPath) throw new Error('usage: patch-penguin-joints.mjs <penguin.glb> <joint-normals.json>');
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);

const key = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
let patched = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  const d = data[mesh.getName()];
  if (!d) continue;
  const index = new Map();
  d.pos.forEach((p, i) => index.set(key(p[0], p[1], p[2]), i));
  const names = mesh.getExtras()?.targetNames ?? [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL').clone();
    prim.setAttribute('NORMAL', nrm);
    const map = [];
    for (let v = 0; v < pos.getCount(); v++) {
      const [x, y, z] = pos.getElement(v, []);
      let i = index.get(key(x, y, z));
      if (i === undefined) {
        // nearest (float noise past the rounding)
        let best = Infinity;
        d.pos.forEach((p, j) => {
          const e = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
          if (e < best) [best, i] = [e, j];
        });
        if (best > 1e-8) throw new Error(`${mesh.getName()}: vertex ${v} has no match (${Math.sqrt(best)} m)`);
      }
      map.push(i);
    }
    const base = d.keys.Basis;
    for (let v = 0; v < map.length; v++) nrm.setElement(v, base[map[v]]);
    prim.listTargets().forEach((target, t) => {
      const name = names[t];
      const n = d.keys[name];
      if (!n) throw new Error(`${mesh.getName()}: no normals for target ${name}`);
      const shared = target.getAttribute('NORMAL');
      if (!shared) throw new Error(`${mesh.getName()}: target ${name} has no NORMAL`);
      // an accessor of its own (the exporter may share an all-zero one between targets)
      const tn = shared.clone().setSparse(false);
      target.setAttribute('NORMAL', tn);
      for (let v = 0; v < map.length; v++) {
        const a = n[map[v]];
        const b = base[map[v]];
        tn.setElement(v, [a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
      }
    });
    patched++;
  }
}
if (!patched) throw new Error('no penguin.joint.* mesh in the file');
await io.write(file, doc);
console.log(`patch-penguin-joints: ${patched} primitives, exact normals`);
