import type {
  AdPlanData,
  Artifact,
  BriefData,
  PayablesData,
  PnlData,
  PurchaseOrderData,
  SnsCalendarData,
  SnsPostsData,
  SupplierComparisonData,
} from '../api/types.gen';
import { useI18n } from '../i18n';
import { PnlView } from './PnlView';
import { Placeholder } from './Status';
import { AdPlanView, PayablesView, PurchaseOrderView, SnsCalendarView, SnsPostsView, SupplierComparisonView } from './WorkProducts';

/** Draw an artifact by its kind (I13). A kind this web does not know is shown as a placeholder. */
export function ArtifactBody({ artifact }: { artifact: Artifact }) {
  const { t } = useI18n();
  switch (artifact.kind) {
    case 'finance.pnl':
      return <PnlView data={artifact.data as unknown as PnlData} />;
    case 'brief':
      return <p className="brief-text">{(artifact.data as unknown as BriefData).text}</p>;
    case 'finance.payables':
      return <PayablesView data={artifact.data as unknown as PayablesData} />;
    case 'sourcing.comparison':
      return <SupplierComparisonView data={artifact.data as unknown as SupplierComparisonData} />;
    case 'sourcing.po':
      return <PurchaseOrderView data={artifact.data as unknown as PurchaseOrderData} />;
    case 'sns.calendar':
      return <SnsCalendarView data={artifact.data as unknown as SnsCalendarData} />;
    case 'sns.posts':
      return <SnsPostsView data={artifact.data as unknown as SnsPostsData} />;
    case 'sns.ads':
      return <AdPlanView data={artifact.data as unknown as AdPlanData} />;
    default:
      return <Placeholder title={t('artifact.unknownKind', { kind: artifact.kind })} />;
  }
}
