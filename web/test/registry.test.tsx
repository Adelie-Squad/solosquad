import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScreenResponse } from '../src/api/types.gen';
import { translate } from '../src/i18n';
import { ScreenBody } from '../src/screens/DeclarativeScreen';
import { resolveWidget, WIDGETS, WidgetSlot, type WidgetProps } from '../src/screens/registry';
import { renderWith } from './helpers';

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);

describe('widget registry (I30)', () => {
  afterEach(cleanup);

  it('knows the minimal widget set — the same ids as the engine (screens.py WIDGETS)', () => {
    expect(Object.keys(WIDGETS).sort()).toEqual(
      ['approvals', 'artifact-latest', 'artifact-list', 'budget', 'office', 'org-chart', 'workflows'].sort(),
    );
  });

  it('resolves known widgets and refuses unknown ids and versions', () => {
    expect(resolveWidget({ widget: 'budget', version: 1 }).ok).toBe(true);
    expect(resolveWidget({ widget: 'weather', version: 1 })).toMatchObject({ ok: false, reason: 'unknown-widget' });
    expect(resolveWidget({ widget: 'budget', version: 7 })).toMatchObject({ ok: false, reason: 'bad-version' });
    expect(resolveWidget({ widget: 'toString', version: 1 }).ok).toBe(false); // no prototype lookups
  });

  it('draws a placeholder for an unknown widget next to a working one', () => {
    const Hello = ({ spec }: WidgetProps) => <p>hello {String(spec.who)}</p>;
    renderWith(
      <>
        <WidgetSlot spec={{ widget: 'hello', version: 1, who: 'kim' }} t={t} registry={{ hello: Hello }} />
        <WidgetSlot spec={{ widget: 'weather', version: 1 }} t={t} registry={{ hello: Hello }} />
      </>,
    );
    expect(screen.getByText('hello kim')).toBeTruthy();
    expect(screen.getByTestId('placeholder').textContent).toContain('weather');
  });

  it('keeps the screen alive when a widget throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      throw new Error('boom');
    };
    renderWith(<WidgetSlot spec={{ widget: 'broken', version: 1 }} t={t} registry={{ broken: Broken }} />);
    expect(screen.getByTestId('placeholder').textContent).toContain('broken');
  });

  it('shows a placeholder for a format version it cannot read, and for an unreadable file', () => {
    const v2: ScreenResponse = { name: 'home', source: 'org', screen: { format_version: 2, title: 'Moa', widgets: [] }, error: null };
    renderWith(<ScreenBody res={v2} t={t} fallbackTitle="Home" />);
    expect(screen.getByText('Moa')).toBeTruthy();
    expect(screen.getByTestId('placeholder').textContent).toContain('format 2');
    cleanup();
    const broken: ScreenResponse = { name: 'home', source: 'org', screen: null, error: 'widgets: Input should be a valid list' };
    renderWith(<ScreenBody res={broken} t={t} fallbackTitle="Home" />);
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByTestId('placeholder').textContent).toContain('valid list');
  });
});
