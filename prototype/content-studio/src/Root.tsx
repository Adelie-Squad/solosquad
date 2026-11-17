import { Composition } from 'remotion';
import { FormatA } from './FormatA';
import { FPS, loadSpec, totalFrames, type Spec } from './spec';

const placeholder: Spec = { title: ['', ''], accent: '#fff', footer: '', cuts: [] };

export function Root() {
  return (
    <Composition
      id="FormatA"
      component={FormatA}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{ spec: placeholder }}
      calculateMetadata={async () => {
        const spec = await loadSpec();
        return { durationInFrames: Math.max(1, totalFrames(spec)), props: { spec } };
      }}
    />
  );
}
