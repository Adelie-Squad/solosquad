import { Composition } from 'remotion';
import { FormatA } from './FormatA';
import { FormatB } from './FormatB';
import { FPS, loadSpec, totalFrames, type Spec } from './spec';

const placeholder: Spec = { title: ['', ''], accent: '#fff', footer: '', cuts: [] };

const formats = [
  { id: 'FormatA', component: FormatA, spec: 'spec' },
  { id: 'FormatB', component: FormatB, spec: 'spec-b' },
] as const;

export function Root() {
  return (
    <>
      {formats.map((f) => (
        <Composition
          key={f.id}
          id={f.id}
          component={f.component}
          width={1080}
          height={1920}
          fps={FPS}
          durationInFrames={1}
          defaultProps={{ spec: placeholder }}
          calculateMetadata={async () => {
            const spec = await loadSpec(f.spec);
            return { durationInFrames: Math.max(1, totalFrames(spec)), props: { spec } };
          }}
        />
      ))}
    </>
  );
}
