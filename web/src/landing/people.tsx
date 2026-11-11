// The example team members on the landing (PRD v2.1.0 §3.5.2 ① · ③): one in the business team and
// one in the brand team — finance and marketing, the people who give the team approvals in the
// workflows section. No names, no photos: a round person silhouette, never a penguin (the penguins
// are the agents).
import { ICON } from '../icons';

export const PEOPLE = ['business', 'brand'] as const;

export function PersonFace({ size = 28 }: { size?: number }) {
  return (
    <span className="landing-person-face" style={{ width: size, height: size }} aria-hidden="true">
      <ICON.person />
    </span>
  );
}
