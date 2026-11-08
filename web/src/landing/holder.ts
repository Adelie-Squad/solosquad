// A group that holds the landing's penguin. The penguin is one cached object shared by every mount
// (office/penguinAsset.ts `useSoloPenguin`), so it must never be moved during render: React can
// render twice and keep only one result (StrictMode in development, a re-suspend anywhere). The
// 2.1 landing did `useMemo(() => { const g = new Group(); g.add(penguin); return g })` — the second
// render moved the penguin into a group React threw away, the kept group stayed empty, the canvas
// drew nothing and the 2D poster faded out over an empty layer ("the penguin appears, then
// disappears"). The group is made pure here and the penguin goes in after commit.
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';

export function useHolder(child: THREE.Object3D): THREE.Group {
  const holder = useMemo(() => new THREE.Group(), []);
  useLayoutEffect(() => {
    holder.add(child);
    return () => {
      if (child.parent === holder) holder.remove(child);
    };
  }, [holder, child]);
  return holder;
}
