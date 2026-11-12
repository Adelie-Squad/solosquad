// Where these screens are shown, when it is not a company server. A page that hosts the app
// somewhere else (the marketing site's demo — its own build, never a company server's) fills these
// in; a company server leaves them all empty, and every screen is exactly the customer's.
import { createContext, useContext, type ReactNode } from 'react';
import { ICON } from '../icons';

export interface ViewOnly {
  /** The quiet line above an area that shows but takes nothing. */
  note: string;
  /** A control or area that takes nothing here (`people.update`, `settings.company` …). */
  locked: (key: string) => boolean;
  /** A press on a locked area (which ones people are curious about). */
  onBlocked?: (key: string) => void;
}

export interface Surface {
  /** A band at the top of the content card. */
  banner?: ReactNode;
  /** More at the bottom of the sidebar, above the account button. */
  sidebarFooter?: (rail: boolean) => ReactNode;
  /** A short word next to the account's role (a chip). */
  roleTag?: string;
  /** Areas and controls that show but take nothing. */
  viewOnly?: ViewOnly;
  /** Starter requests of their own, in place of the default ones (sent as they are). */
  suggestions?: string[];
  /** The office may open in a window of its own (default true). */
  popout?: boolean;
}

const EMPTY: Surface = {};

export const SurfaceContext = createContext<Surface>(EMPTY);

export const useSurface = () => useContext(SurfaceContext);

/** true when `key` takes nothing here. */
export function useLocked(): (key: string) => boolean {
  const v = useSurface().viewOnly;
  return (key) => !!v?.locked(key);
}

/**
 * An area that shows but takes nothing when the surface says so: the quiet line above, every
 * control inside disabled (one `fieldset disabled`). Elsewhere it renders its children unchanged.
 */
export function ViewOnlyArea({ name, children, inline = false }: { name: string; children: ReactNode; inline?: boolean }) {
  const v = useSurface().viewOnly;
  if (!v?.locked(name)) return <>{children}</>;
  return (
    <div className={`view-only ${inline ? 'is-inline' : ''}`} data-testid="view-only" onPointerDownCapture={() => v.onBlocked?.(name)}>
      <p className="view-only-note with-icon" role="note">
        <ICON.locked size={14} />
        {v.note}
      </p>
      <fieldset className="view-only-body" disabled>
        {children}
      </fieldset>
    </div>
  );
}
