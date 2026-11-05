/* ------------------------------------------------------------------ *
 *  Excel (.xlsx) export for the admin panel: one sheet of participants and
 *  one sheet per pass, then the gate-entry and event-attendance scans.
 * ------------------------------------------------------------------ */
import type { Registration } from './adminData';
import type { Profile } from './identity';
import type { AttendanceRow } from './backend';
import { HEROES } from './App';

type Cell = string | number | { value: string | number; fontWeight?: 'bold' };
export type SheetSpec = { sheet: string; data: Cell[][]; columns: { width: number }[]; stickyRowsCount: number };

const PASS_TABS: { pass: string; tab: string }[] = [
  { pass: 'hackathon', tab: 'Hackathon Teams' },
  { pass: 'oneday', tab: 'One-Day Pass' },
  { pass: 'twoday', tab: 'Two-Day Pass' },
  { pass: 'exclusive', tab: 'Exclusive Pass' }
];
const FEST_DAYS = ['FEB 4', 'FEB 5'];

const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: 'bold' as const }));
const dayLabel = (r: Registration) =>
  r.pass === 'oneday' ? (r.day == null ? '' : FEST_DAYS[r.day] ?? '') : r.pass === 'hackathon' ? 'FEB 4-5 (24 HOURS)' : 'FEB 4 & 5';
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const buildSheets = (registrations: Registration[], profiles: Profile[], attendance: AttendanceRow[]): SheetSpec[] => {
  const sheets: SheetSpec[] = [{
    sheet: 'Participants',
    data: [
      head(['Optimus ID', 'Name', 'Email', 'Phone', 'College', 'Joined']),
      ...profiles.map((p): Cell[] => [p.id, p.name, p.email, p.phone, p.college, when(p.created_at)])
    ],
    columns: [{ width: 14 }, { width: 26 }, { width: 30 }, { width: 16 }, { width: 34 }, { width: 20 }],
    stickyRowsCount: 1
  }];

  for (const { pass, tab } of PASS_TABS) {
    const rows = registrations.filter((r) => r.pass === pass);
    sheets.push({
      sheet: tab,
      data: [
        head(['Registered', 'Team name', 'Leader', 'Member 2', 'Member 3', 'Member 4', 'Email', 'Phone', 'College', 'Day', 'Team size', 'Amount (INR)']),
        ...rows.map((r): Cell[] => [
          when(r.created_at), r.team_name ?? '', r.leader_name,
          r.members[0] ?? '', r.members[1] ?? '', r.members[2] ?? '',
          r.email, r.phone, r.college, dayLabel(r), r.members.length + 1, r.amount
        ])
      ],
      columns: [{ width: 20 }, { width: 22 }, { width: 30 }, { width: 30 }, { width: 30 }, { width: 30 }, { width: 30 }, { width: 16 }, { width: 30 }, { width: 18 }, { width: 10 }, { width: 14 }],
      stickyRowsCount: 1
    });
  }

  // What the QR scanners recorded: who came through the gate each day, and who attended which event.
  const title = (id: string | null) => HEROES.flatMap((h) => h.events).find((e) => e.id === id)?.title ?? id ?? '';
  const scanCols = [{ width: 14 }, { width: 26 }, { width: 34 }, { width: 18 }, { width: 22 }, { width: 28 }, { width: 10 }];
  const scanRow = (a: AttendanceRow): Cell[] => [a.optimusId, a.name, a.college, FEST_DAYS[a.day] ?? '', when(a.at), a.by, a.manual ? 'YES' : ''];
  sheets.push({
    sheet: 'Gate Entry',
    data: [head(['Optimus ID', 'Name', 'College', 'Day', 'Scanned at', 'Scanned by', 'Manual']), ...attendance.filter((a) => a.kind === 'entry').map(scanRow)],
    columns: scanCols, stickyRowsCount: 1
  });
  sheets.push({
    sheet: 'Event Attendance',
    data: [
      head(['Optimus ID', 'Name', 'College', 'Day', 'Scanned at', 'Scanned by', 'Manual', 'Event']),
      ...attendance.filter((a) => a.kind === 'event').map((a): Cell[] => [...scanRow(a), title(a.eventId)])
    ],
    columns: [...scanCols, { width: 28 }], stickyRowsCount: 1
  });
  return sheets;
};

/** Builds the workbook and downloads it in the browser. */
export const downloadWorkbook = async (registrations: Registration[], profiles: Profile[], attendance: AttendanceRow[]) => {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const stamp = new Date().toISOString().slice(0, 10);
  await writeXlsxFile(buildSheets(registrations, profiles, attendance) as Parameters<typeof writeXlsxFile>[0]).toFile(`optimus27-registrations-${stamp}.xlsx`);
};
