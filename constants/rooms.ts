// Master list of the château's rooms — the single source of truth.
// Pure module (no React Native imports) so both the Expo app and the Vercel
// API function can import it. The API must import by RELATIVE path
// (`../constants/rooms`), not the `@/` alias, which the function build doesn't resolve.

export const ROOMS = [
  { key: 'attic',          label: 'Attic' },
  { key: 'cottage_1',      label: 'Cottage One' },
  { key: 'cottage_2',      label: 'Cottage Two' },
  { key: 'cottage_3',      label: 'Cottage Three' },
  { key: 'emmas',          label: "Emma's",         owner: 'Emma' },
  { key: 'gite_1',         label: 'Gîte One' },
  { key: 'gite_2',         label: 'Gîte Two' },
  { key: 'yellow',         label: 'Yellow',         owner: 'Lise' },
  { key: 'master',         label: 'Master' },
  { key: 'posh',           label: 'Posh',           owner: 'Natalie' },
  { key: 'peach',          label: 'Peach' },
  { key: 'princess_tower', label: 'Princess Tower' },
  { key: 'roos',           label: "Roo's",          owner: 'Roo' },
  { key: 'blue',           label: 'Blue',           owner: 'Sarah' },
  { key: 'twin',           label: 'Twin' },
  { key: 'family_room',    label: 'Family Room' },
  { key: 'chapel',         label: 'Chapel' },
] as const;

export type RoomKey = typeof ROOMS[number]['key'];

export const ROOM_LABELS: Record<string, string> =
  Object.fromEntries(ROOMS.map(r => [r.key, r.label]));

export const VALID_ROOM_KEYS = new Set<string>(ROOMS.map(r => r.key));

export const roomLabel = (k?: string | null): string | null =>
  k ? ROOM_LABELS[k] ?? k : null;

// Auto-assign (owned rooms): owner first-name → their room key, e.g. { lise: 'yellow' }.
const OWNER_ROOM: Record<string, string> = Object.fromEntries(
  ROOMS.filter((r): r is typeof r & { owner: string } => 'owner' in r)
       .map(r => [r.owner.toLowerCase(), r.key]),
);

// The room a person defaults to (their owned room) when no explicit room is set.
// Keyed on first name; returns null for non-owners.
export const defaultRoomForName = (name?: string | null): string | null => {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0].toLowerCase();
  return OWNER_ROOM[first] ?? null;
};

// The effective room for a person: an explicit allocation wins over the owner default.
// Retained for single-room needs (e.g. "which room is this person in today?").
export const effectiveRoom = (explicit?: string | null, name?: string | null): string | null =>
  explicit ?? defaultRoomForName(name);

// ── Date-ranged room allocations ──────────────────────────────────────────────
// A person can occupy a room for part of their stay, then move. Ranges are
// INCLUSIVE (a person occupies `room` on every day from start..end); one room per
// person per day. Shared by the app and the Vercel API (relative import).

export type Allocation = { id?: string; room: string; start: string; end: string };

type DatedMember = { name?: string | null; arriveDate?: string | null; departDate?: string | null };

const ymd = (d?: string | null): string | null => (d ? String(d).slice(0, 10) : null);

// The effective segment list for a member: their explicit allocations (sorted by
// start) if any; otherwise a single synthesized whole-stay segment when they own a
// room and have a visit; otherwise none. The owner default is NEVER stored in the
// DB — it's computed identically here on client and server, and disappears the
// moment any explicit segment exists.
export const allocationsForMember = (
  explicit: Allocation[] | null | undefined,
  member: DatedMember,
): Allocation[] => {
  if (explicit && explicit.length) {
    return [...explicit].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }
  const owned = defaultRoomForName(member.name);
  const a = ymd(member.arriveDate);
  const d = ymd(member.departDate);
  return owned && a && d ? [{ room: owned, start: a, end: d }] : [];
};

// Night-model overlap test — shared by client + server allocation validation.
// A person sleeps nights start..end-1, so two segments conflict only if they share a
// night: `a.start < b.end && b.start < a.end`. A shared boundary day (a.end === b.start)
// is allowed — that's a same-day room move (out of A / into B on the same date).
export const segmentsOverlap = (
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean => a.start < b.end && b.start < a.end;
