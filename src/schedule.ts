/* ------------------------------------------------------------------ *
 *  Which event is what kind, which day it runs on, and what each pass
 *  lets a person book. supabase/schema.sql seeds the same table, and the
 *  server re-checks every booking against it, so keep the two in step.
 *
 *  The day of each event is a first draft: change it here AND in the
 *  `events` insert at the top of supabase/schema.sql once the organisers
 *  confirm the timetable.
 * ------------------------------------------------------------------ */

export type EventKind = 'hackathon' | 'presentation' | 'workshop' | 'nontech';

export const KIND_LABEL: Record<EventKind, string> = {
  hackathon: 'Hackathon',
  presentation: 'Presentation',
  workshop: 'Workshop',
  nontech: 'Non-technical'
};

// day: 0 = Feb 4, 1 = Feb 5. The hackathon starts on day 0 and is checked in once, at the start.
export const EVENT_SCHEDULE: Record<string, { kind: EventKind; day: 0 | 1 }> = {
  hackathon: { kind: 'hackathon', day: 0 },
  paper: { kind: 'presentation', day: 0 },
  project: { kind: 'presentation', day: 0 },
  poster: { kind: 'presentation', day: 1 },
  'presentation-4': { kind: 'presentation', day: 1 },
  'workshop-core': { kind: 'workshop', day: 0 },
  'workshop-track-3': { kind: 'workshop', day: 0 },
  'workshop-track-2': { kind: 'workshop', day: 1 },
  photography: { kind: 'nontech', day: 0 },
  'quiz-fun': { kind: 'nontech', day: 0 },
  gaming: { kind: 'nontech', day: 1 }
};

// How many events of each kind a booked pass allows. Exclusive takes every non-hackathon event;
// the hackathon pass is the hackathon only.
export const PASS_QUOTA: Record<'oneday' | 'twoday', Record<'presentation' | 'workshop' | 'nontech', number>> = {
  oneday: { presentation: 1, workshop: 1, nontech: 1 },
  twoday: { presentation: 2, workshop: 2, nontech: 2 }
};

export type Booking = { eventId: string; day: number; attended: boolean };
export type MyPassData = {
  events: Booking[];
  entryDays: number[];          // days on which the gate scan was recorded
  passes: { pass: string; day: number | null; teamName: string | null }[];
};
