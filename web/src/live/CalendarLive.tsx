// The calendar's live notes (decision 60): one stream for the whole account — `/api/calendar/events`
// — mounted once per signed-in tab. A note carries ids only and reaches only people who may see the
// entry; it just marks the calendar cache stale, the API stays the truth (I8). Other windows of the
// same browser (the office pop-out) also hear about a change over the data channel (lib/channels).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { calendarKeys } from '../api/queries';
import type { EngineEvent } from '../api/types.gen';
import { LiveStream, type EventSourceFactory } from './stream';

export const CALENDAR_EVENTS = '/api/calendar/events';

const browserFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true });

export function CalendarLive({ factory = browserFactory }: { factory?: EventSourceFactory }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined' && factory === browserFactory) return;
    const onNote = (ev: EngineEvent) => {
      const kind = (ev as unknown as { event?: string }).event;
      if (kind === 'calendar.changed' || kind === 'calendar.labels') void qc.invalidateQueries({ queryKey: calendarKeys.all });
    };
    const stream = new LiveStream(CALENDAR_EVENTS, factory, onNote);
    stream.start();
    return () => stream.stop();
  }, [qc, factory]);
  return null;
}
