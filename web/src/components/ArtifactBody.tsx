import type { Artifact, BriefData, PnlData } from '../api/types.gen';
import { useI18n } from '../i18n';
import { PnlView } from './PnlView';
import { Placeholder } from './Status';

/** Draw an artifact by its kind (I13). A kind this web does not know is shown as a placeholder. */
export function ArtifactBody({ artifact }: { artifact: Artifact }) {
  const { t } = useI18n();
  switch (artifact.kind) {
    case 'finance.pnl':
      return <PnlView data={artifact.data as unknown as PnlData} />;
    case 'brief':
      return <p className="brief-text">{(artifact.data as unknown as BriefData).text}</p>;
    default:
      return <Placeholder title={t('artifact.unknownKind', { kind: artifact.kind })} />;
  }
}
