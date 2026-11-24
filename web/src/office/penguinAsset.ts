// The penguin GLB and how it loads (asset contract §1 · §5), shared by the office scene and the
// landing's mascot — one URL, one useGLTF cache entry, one meshopt setup. three.js / drei only:
// importing this pulls the 3D code, so only lazily loaded chunks import it.
import { useGLTF } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type * as THREE from 'three';
import kitUrl from 'office-asset:office-kit.glb';
import penguinUrl from 'office-asset:penguin.glb';
import { dressPenguin } from './kit';
import { makeJoints, type Joints } from './joint';
import { lazyMeshopt } from './meshopt';

export { kitUrl, penguinUrl };

// draco off (the contract uses meshopt); the meshopt decoder is set but compiles only for a
// compressed file (see meshopt.ts).
export const withMeshopt = (loader: { setMeshoptDecoder: (d: never) => unknown }) => void loader.setMeshoptDecoder(lazyMeshopt as never);

/** Start fetching penguin.glb (and nothing else). */
export const preloadPenguin = () => useGLTF.preload(penguinUrl, false, false, withMeshopt);

const solo = new WeakMap<object, { penguin: THREE.Object3D; joints: Joints }>();

/**
 * One penguin on its own — the landing's mascot. A skinned clone of the cached GLB (the office
 * may use the same cache later, so the source is never changed), with no role prop at all
 * (DESIGN.md `## 에이전트 캐릭터` — 마스코트 = 소품 없는 기본 펭귄). Suspends while loading.
 */
export function useSoloPenguin(): { penguin: THREE.Object3D; joints: Joints; source: THREE.Object3D; clips: THREE.AnimationClip[] } {
  const gltf = useGLTF(penguinUrl, false, false, withMeshopt);
  let own = solo.get(gltf);
  if (!own) {
    const penguin = cloneSkinned(gltf.scene);
    dressPenguin(penguin, '', true);
    // the joints read the rest pose — now, before any clip has moved a bone
    own = { penguin, joints: makeJoints(penguin) };
    solo.set(gltf, own);
  }
  return { ...own, source: gltf.scene, clips: gltf.animations };
}
