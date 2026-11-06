// The clay look's soft environment light, shared by the office scene and the landing's mascot.
import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * The soft environment light (`clay.sky`): a one-colour sky with a brighter panel overhead, baked
 * once into a PMREM map — tops read lighter than sides, the clay look without a line. Small on
 * purpose: drei's `<Environment>` would bring its HDR / EXR / gain-map loaders (~54 kB) for this.
 */
export function SkyLight({ color, intensity }: { color: string; intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const sky = new THREE.Scene();
    sky.background = new THREE.Color(color);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    (panel.material as THREE.MeshBasicMaterial).color.multiplyScalar(1.6);
    panel.position.y = 5;
    panel.rotation.x = Math.PI / 2;
    sky.add(panel);
    const target = pmrem.fromScene(sky, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      panel.geometry.dispose();
      (panel.material as THREE.Material).dispose();
    };
  }, [gl, scene, color, intensity, invalidate]);
  return null;
}
