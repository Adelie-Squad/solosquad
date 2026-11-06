// @vitest-environment node
// The asset contract (docs/design/office-asset-contract.md): the check finds what a GLB lacks, the
// placeholder honours every name, a meshopt-compressed file decodes, and the office builds from
// the GLBs — seats, props on their sockets, clips per state, materials swapped by name.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder as MeshoptCodec, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { teamColor } from '../src/characters/colors';
import { ALL_PROPS, CLIPS, MODULES, PENGUIN_HEIGHT, SEAT_OFFSET, checkGltf, lampOffset, paletteKey, checkOfficeAssets, formatReport, readGlbJson, type GltfJson } from '../src/office/contract';
import { applyLook, buildOffice, dressPenguin, findNode, MaterialBank, nameOf, playStatus } from '../src/office/kit';
import { lazyMeshopt } from '../src/office/meshopt';
import { DAY, EVENING } from '../src/office/palette';

const dir = join(process.cwd(), 'office-placeholder');
const kitBytes = new Uint8Array(readFileSync(join(dir, 'office-kit.glb')));
const penguinBytes = new Uint8Array(readFileSync(join(dir, 'penguin.glb')));

function load(bytes: Uint8Array): Promise<GLTF> {
  const loader = new GLTFLoader().setMeshoptDecoder(lazyMeshopt as never);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((ok, fail) => loader.parse(buf, '', ok, fail));
}

describe('contract check', () => {
  it('passes the placeholder kit with nothing missing', () => {
    const reports = checkOfficeAssets({ kit: kitBytes, penguin: penguinBytes });
    expect(reports.map((r) => r.missing)).toEqual([[], []]);
    expect(formatReport(reports)).toMatch(/^ok {3}office-kit\.glb/m);
  });

  it('lists what is missing, by name', () => {
    const kit = readGlbJson(kitBytes);
    const broken: GltfJson = {
      ...kit,
      nodes: kit.nodes!.map((n) => (n.name === 'desk.chief' ? { ...n, name: 'desk_chief' } : n)),
      // every per-module instance of the key gone = the base key is missing
      materials: kit.materials!.filter((m) => paletteKey(m.name ?? '') !== 'team_sticker'),
    };
    const r = checkGltf(broken, 'kit');
    expect(r.missing).toContain('module desk.chief');
    expect(r.missing).toContain('material team_sticker');

    const peng = readGlbJson(penguinBytes);
    const noDoze: GltfJson = {
      ...peng,
      animations: peng.animations!.filter((a) => a.name !== 'idle_doze').map((a) => (a.name === 'typing' ? { ...a, name: 'Typing' } : a)),
      nodes: peng.nodes!.map((n) => (n.name === 'prop.sales.card' ? { ...n, extras: {} } : n.name === 'socket.hand.R' ? { ...n, name: 'hand_socket' } : n)),
    };
    const p = checkGltf(noDoze, 'penguin');
    expect(p.missing).toEqual(
      expect.arrayContaining(['clip idle_doze', 'clip typing', 'bone socket.hand.R', expect.stringMatching(/^prop prop\.sales\.card: custom property socket/)]),
    );
    expect(p.warnings).toContain('clip Typing is not a state id — the web ignores it');
  });

  it('warns on the matte look and the budget, without failing', () => {
    const kit = readGlbJson(kitBytes);
    const shiny: GltfJson = { ...kit, materials: kit.materials!.map((m) => (m.name === 'clay.wood#desk.set' ? { ...m, pbrMetallicRoughness: { roughnessFactor: 0.3 } } : m)) };
    const r = checkGltf(shiny, 'kit');
    expect(r.missing).toEqual([]);
    expect(r.warnings).toEqual(expect.arrayContaining(['material clay.wood#desk.set: metallic 1 (contract: 0)', 'material clay.wood#desk.set: roughness 0.3 (contract: ≥ 0.8)']));
    const big = checkOfficeAssets({ kit: kitBytes, penguin: new Uint8Array(6 * 1024 * 1024) });
    expect(big[1].missing[0]).toMatch(/^readable GLB/);
    expect(big[0].warnings.at(-1)).toMatch(/budget 5 MB/);
    expect(checkOfficeAssets({ kit: kitBytes })[1].missing).toEqual(['file penguin.glb']);
  });

  it('knows every name the scene looks up', () => {
    const kit = readGlbJson(kitBytes);
    const peng = readGlbJson(penguinBytes);
    for (const m of MODULES) expect(kit.nodes!.some((n) => n.name === m), m).toBe(true);
    for (const p of ALL_PROPS) expect(peng.nodes!.some((n) => n.name === p), p).toBe(true);
    expect(peng.animations!.map((a) => a.name).sort()).toEqual([...CLIPS].sort());
    expect((kit.asset as { extras?: { placeholder?: boolean } }).extras?.placeholder).toBe(true);
  });
});

describe('the GLBs in three.js', () => {
  it('decodes a meshopt-compressed file with the decoder the scene sets up', async () => {
    await MeshoptEncoder.ready;
    await MeshoptCodec.ready;
    const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptCodec });
    const doc: Document = await io.readBinary(penguinBytes);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const packed = await io.writeBinary(doc);
    expect(readGlbJson(packed).extensionsUsed).toContain('EXT_meshopt_compression');
    expect(checkGltf(readGlbJson(packed), 'penguin').missing).toEqual([]);
    const gltf = await load(packed);
    expect(findNode(gltf.scene, 'penguin')).toBeTruthy();
    expect(gltf.animations.map((a) => a.name).sort()).toEqual([...CLIPS].sort());
  });

  it('keeps the dotted names three strips from Object3D.name', async () => {
    const gltf = await load(kitBytes);
    const floor = findNode(gltf.scene, 'room.floor_tile')!;
    expect(floor.name).toBe('roomfloor_tile');
    expect(nameOf(floor)).toBe('room.floor_tile');
  });

  it('builds the office: a desk and a dressed, animated penguin per agent', async () => {
    const [kit, penguin] = await Promise.all([load(kitBytes), load(penguinBytes)]);
    const bank = new MaterialBank([kit.scene, penguin.scene], DAY);
    const agents = [
      { name: 'chief', team: 'core' },
      { name: 'researcher', team: 'product' },
      { name: 'infra-security', team: 'engineering' },
      { name: 'noodle-chef', team: 'kitchen' },
    ];
    const office = buildOffice({ kit, penguin }, agents, bank, 1.6);
    expect([...office.seats.keys()].sort()).toEqual(agents.map((a) => a.name).sort());
    expect(office.room.cols).toBeGreaterThanOrEqual(2);

    const props = (name: string) => {
      const out: string[] = [];
      office.seats.get(name)!.penguin.traverse((o) => nameOf(o).startsWith('prop.') && out.push(nameOf(o)));
      return out.sort();
    };
    expect(props('chief')).toEqual(['prop.chief.bowtie', 'prop.chief.crown']);
    expect(props('infra-security')).toEqual(['prop.infra.hardhat', 'prop.infra.shield']); // the old id keeps its look
    expect(props('noodle-chef')).toEqual(['prop.scarf']);
    // rigid props hang on their socket bones, so the clips carry them
    const crown = findNode(office.seats.get('chief')!.penguin, 'prop.chief.crown')!;
    expect(nameOf(crown.parent!)).toBe('socket.head');

    // team colours by material name, one material per team
    const sticker = (name: string) => {
      let colour = '';
      office.seats.get(name)!.desk.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && paletteKey(m.name) === 'team_sticker') colour = `#${m.color.getHexString()}`;
      });
      return colour.toUpperCase();
    };
    expect(sticker('researcher')).toBe(teamColor('product').toUpperCase());
    expect(sticker('chief')).toBe(teamColor('core').toUpperCase());

    // a clip per state; evening idle dozes; the theme recolours in place
    const seat = office.seats.get('researcher')!;
    playStatus(seat, 'typing', false, false);
    expect(seat.current?.getClip().name).toBe('typing');
    playStatus(seat, 'idle', true, false);
    expect(seat.current?.getClip().name).toBe('idle_doze');
    playStatus(seat, 'waiting', true, true);
    expect(seat.current?.time).toBe(0);

    const wall = findNode(kit.scene, 'room.wall_left') as THREE.Object3D;
    let wallMat: THREE.MeshStandardMaterial | null = null;
    wall.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) wallMat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    });
    bank.setPalette(EVENING);
    expect(`#${wallMat!.color.getHexString()}`.toUpperCase()).toBe(EVENING.materials['clay.wall']);
    applyLook(seat, 'typing', EVENING, bank);
    expect(seat.lamp?.visible).toBe(true);
    expect(seat.pool?.visible).toBe(true);
    const screen = seat.screens[0].material as THREE.MeshStandardMaterial;
    expect(`#${screen.emissive.getHexString()}`.toUpperCase()).toBe(EVENING.screenGlow);
    applyLook(seat, 'idle', EVENING, bank);
    expect(seat.pool?.visible).toBe(false);
    expect((seat.screens[0].material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    bank.setPalette(DAY);
    applyLook(seat, 'idle', DAY, bank);
    expect(seat.lamp?.visible).toBe(false);
    office.dispose();
    bank.dispose();
  });

  it('reads per-module material instances by their palette key (`<key>#<module>`)', async () => {
    const json = readGlbJson(kitBytes);
    const names = json.materials!.map((m) => m.name ?? '');
    expect(names).toEqual(expect.arrayContaining(['clay.furniture#desk.set', 'clay.furniture#desk.chief', 'team_sticker#desk.set', 'clay.wall#room.wall_left']));
    expect(names.every((n) => n.includes('#'))).toBe(true);
    expect(paletteKey('clay.furniture#desk.set')).toBe('clay.furniture');
    expect(paletteKey('penguin.body')).toBe('penguin.body');
    // plain keys pass the check too (one shared material per key)
    const plain: GltfJson = { ...json, materials: json.materials!.map((m) => ({ ...m, name: paletteKey(m.name ?? '') })) };
    expect(checkGltf(plain, 'kit').missing).toEqual([]);

    const kit = await load(kitBytes);
    const penguin = await load(penguinBytes);
    const bank = new MaterialBank([kit.scene, penguin.scene], DAY);
    const office = buildOffice({ kit, penguin }, [{ name: 'chief', team: 'core' }, { name: 'sales', team: 'business' }], bank, 1.6);
    const colourOf = (root: THREE.Object3D, name: string) => {
      let hex = '';
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.name === name) hex = `#${m.color.getHexString()}`.toUpperCase();
      });
      return hex;
    };
    const desk = office.seats.get('sales')!.desk;
    expect(colourOf(desk, 'team_sticker#desk.set')).toBe(teamColor('business').toUpperCase());
    expect(colourOf(office.seats.get('chief')!.desk, 'team_sticker#desk.chief')).toBe(teamColor('core').toUpperCase());
    expect(colourOf(desk, 'clay.furniture#desk.set')).toBe(DAY.materials['clay.furniture']);
    bank.setPalette(EVENING);
    expect(colourOf(desk, 'clay.furniture#desk.set')).toBe(EVENING.materials['clay.furniture']);
    expect(colourOf(office.root, 'clay.wall#room.wall_back')).toBe(EVENING.materials['clay.wall']);
    office.dispose();
    bank.dispose();
  });

  it('seats the penguin and the lamp at the contract offsets; the penguin is 0.60 m', async () => {
    const [kit, penguin] = await Promise.all([load(kitBytes), load(penguinBytes)]);
    const bank = new MaterialBank([kit.scene, penguin.scene], DAY);
    const office = buildOffice({ kit, penguin }, [{ name: 'chief', team: 'core' }, { name: 'sales', team: 'business' }], bank, 1.6);
    for (const [name, module] of [['sales', 'desk.set'], ['chief', 'desk.chief']] as const) {
      const seat = office.seats.get(name)!;
      const local = (o: THREE.Object3D) => seat.desk.worldToLocal(o.getWorldPosition(new THREE.Vector3())).toArray().map((v) => +v.toFixed(3));
      expect(local(seat.penguin)).toEqual(SEAT_OFFSET);
      expect(local(seat.lamp!)).toEqual(lampOffset(module).map((v) => +v.toFixed(3)));
    }
    expect(SEAT_OFFSET).toEqual([0, 0.42, -0.27]);
    expect(lampOffset('desk.set').map((v) => +v.toFixed(3))).toEqual([-0.36, 0.72, 0.02]);
    const height = new THREE.Box3().setFromObject(findNode(penguin.scene, 'penguin')!, true).getSize(new THREE.Vector3()).y;
    expect(height).toBeCloseTo(PENGUIN_HEIGHT, 1);
    office.dispose();
    bank.dispose();
  });

  it('keeps each module root\'s own transform (quantization moves the mesh into it)', async () => {
    const json = readGlbJson(kitBytes);
    const desk = json.nodes!.find((n) => n.name === 'desk.set') as { translation?: number[]; scale?: number[] };
    expect(desk.translation?.[1]).toBeGreaterThan(0.1); // the placeholder is quantized like the real kit
    const [kit, penguin] = await Promise.all([load(kitBytes), load(penguinBytes)]);
    const bank = new MaterialBank([kit.scene, penguin.scene], DAY);
    const office = buildOffice({ kit, penguin }, [{ name: 'sales', team: 'business' }], bank, 1.6);
    const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    office.root.updateMatrixWorld(true);
    const deskBox = box(office.seats.get('sales')!.desk);
    expect(deskBox.min.y).toBeCloseTo(0, 1);
    expect(deskBox.max.y).toBeGreaterThan(0.72);
    // the left wall stands just outside the room's −X edge, 2.4 m tall, on the floor
    let wall: THREE.Object3D | null = null;
    office.root.traverse((o) => {
      if (!wall && o.name === 'room.wall_left@') wall = o;
    });
    const w = box(wall!);
    expect(w.max.x).toBeCloseTo(office.room.minX, 2);
    expect(w.min.x).toBeCloseTo(office.room.minX - 0.12, 2);
    expect(w.min.y).toBeCloseTo(0, 2);
    expect(w.max.y).toBeCloseTo(2.4, 1);
    const floorBox = box(office.root.children[0]);
    expect(floorBox.max.y).toBeGreaterThan(2.3);
    office.dispose();
    bank.dispose();
  });

  it('dresses an unknown role in the scarf even when its props are half there', async () => {
    const penguin = await load(penguinBytes);
    const p = penguin.scene.clone(true);
    expect(dressPenguin(p, 'sales')).toEqual(['prop.sales.card']);
    const q = penguin.scene.clone(true);
    findNode(q, 'prop.finance.calculator')!.removeFromParent();
    expect(dressPenguin(q, 'finance')).toEqual(['prop.scarf']);
  });
});

// the Blender session's export (assets/office/export, PR #58) — checked and built when it is there
const realDir = join(process.cwd(), '..', 'assets', 'office', 'export');
const real = existsSync(join(realDir, 'office-kit.glb')) && existsSync(join(realDir, 'penguin.glb'));

describe.skipIf(!real)('the delivered GLBs (assets/office/export)', () => {
  it('honour the contract and build a dressed, animated office', async () => {
    const kitReal = new Uint8Array(readFileSync(join(realDir, 'office-kit.glb')));
    const penguinReal = new Uint8Array(readFileSync(join(realDir, 'penguin.glb')));
    expect(checkOfficeAssets({ kit: kitReal, penguin: penguinReal }).map((r) => r.missing)).toEqual([[], []]);
    // node has no image decoder: drop the (WebP AO) textures before three reads the files
    await MeshoptCodec.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptCodec });
    const untextured = async (bytes: Uint8Array) => {
      const doc = await io.readBinary(bytes);
      for (const t of doc.getRoot().listTextures()) t.dispose();
      for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'EXT_texture_webp') e.dispose();
      return io.writeBinary(doc);
    };
    const [kit, penguin] = await Promise.all([load(await untextured(kitReal)), load(await untextured(penguinReal))]);
    const bank = new MaterialBank([kit.scene, penguin.scene], DAY);
    const agents = [
      { name: 'chief', team: 'core' },
      { name: 'researcher', team: 'product' },
      { name: 'noodle-chef', team: 'kitchen' },
    ];
    const office = buildOffice({ kit, penguin }, agents, bank, 1.6);
    expect(office.seats.size).toBe(3);
    const seat = office.seats.get('researcher')!;
    expect(seat.lamp).not.toBeNull();
    expect(seat.screens.length).toBeGreaterThan(0);
    playStatus(seat, 'typing', false, false);
    expect(seat.current?.getClip().name).toBe('typing');
    bank.setPalette(EVENING);
    applyLook(seat, 'typing', EVENING, bank);
    expect(seat.pool?.visible).toBe(true);
    office.dispose();
    bank.dispose();
  });
});
