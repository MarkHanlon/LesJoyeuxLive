export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function formatDateLong(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00').getTime() - now.getTime()) / 86400000);
}

export function slotLabel(slot: string): string {
  const m: Record<string, string> = {
    morning: 'morning', lunchtime: 'lunchtime',
    afternoon: 'afternoon', dinnertime: 'dinner time', evening: 'evening',
  };
  return m[slot] ?? slot;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Monday-based week boundaries (YYYY-MM-DD in, YYYY-MM-DD out).
export function startOfWeek(dateStr: string): string {
  const day = new Date(dateStr + 'T12:00:00').getDay(); // 0 Sun … 6 Sat
  return addDays(dateStr, day === 0 ? -6 : 1 - day);
}
export function endOfWeek(dateStr: string): string {
  return addDays(startOfWeek(dateStr), 6);
}

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
