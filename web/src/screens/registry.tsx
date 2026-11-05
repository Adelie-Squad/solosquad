// The widget registry (PRD v2.1.0 I30). A screen file names widgets by id; this table says
// how to draw each. The ids must match `python/src/solosquad/screens.py WIDGETS`. A widget
// id or a format version this web does not know becomes a visible placeholder, never a crash.
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { Screen, WidgetSpec } from '../api/types.gen';
import { Placeholder } from '../components/Status';
import type { Translate } from '../i18n';
import {
  ApprovalsWidget,
  ArtifactLatestWidget,
  ArtifactListWidget,
  BudgetWidget,
  OfficeWidget,
  OrgChartWidget,
  WorkflowsWidget,
} from './widgets';

export const SUPPORTED_FORMATS = [1];

export interface WidgetProps {
  spec: WidgetSpec;
}

export const WIDGETS: Record<string, ComponentType<WidgetProps>> = {
  approvals: ApprovalsWidget,
  'artifact-latest': ArtifactLatestWidget,
  'artifact-list': ArtifactListWidget,
  budget: BudgetWidget,
  office: OfficeWidget,
  workflows: WorkflowsWidget,
  'org-chart': OrgChartWidget,
};

export type Resolved =
  | { ok: true; Widget: ComponentType<WidgetProps>; spec: WidgetSpec }
  | { ok: false; reason: 'unknown-widget' | 'bad-version'; spec: WidgetSpec };

/** Which component draws this spec — or why none can. */
export function resolveWidget(spec: WidgetSpec, registry: Record<string, ComponentType<WidgetProps>> = WIDGETS): Resolved {
  const Widget = Object.prototype.hasOwnProperty.call(registry, spec.widget) ? registry[spec.widget] : undefined;
  if (!Widget) return { ok: false, reason: 'unknown-widget', spec };
  if ((spec.version ?? 1) !== 1) return { ok: false, reason: 'bad-version', spec };
  return { ok: true, Widget, spec };
}

export function screenSupported(screen: Screen): boolean {
  return SUPPORTED_FORMATS.includes(screen.format_version);
}

/** A widget that throws while drawing shows a placeholder instead of taking the screen down. */
export class WidgetBoundary extends Component<{ name: string; t: Translate; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`widget ${this.props.name} failed`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <Placeholder title={this.props.t('screen.widgetFailed', { widget: this.props.name })} />;
    return this.props.children;
  }
}

export function WidgetSlot({ spec, t, registry }: { spec: WidgetSpec; t: Translate; registry?: Record<string, ComponentType<WidgetProps>> }) {
  const r = resolveWidget(spec, registry);
  if (!r.ok) {
    const title =
      r.reason === 'unknown-widget'
        ? t('screen.unknownWidget', { widget: spec.widget })
        : t('screen.badWidgetVersion', { widget: spec.widget, version: spec.version ?? '?' });
    return <Placeholder title={title} detail={t('screen.placeholderHint')} />;
  }
  const { Widget } = r;
  return (
    <WidgetBoundary name={spec.widget} t={t}>
      <Widget spec={spec} />
    </WidgetBoundary>
  );
}
