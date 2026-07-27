import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { DRINK_ICONS, DRINK_LABELS } from '../../constants/drinks';
import { ROOMS, roomLabel, allocationsForMember, segmentsOverlap, type Allocation } from '../../constants/rooms';
import { addDays, datesBetween, daysUntil, endOfWeek, formatDate, formatDateLong, slotLabel, startOfWeek, todayStr } from '../../utils/date';
import { avatarColor, initials } from '../../utils/ui';

const ADMIN_DAYS_BEFORE = 7;
const ADMIN_DAYS_AFTER = 30;

// Pending approvals are the most time-sensitive, so the Family tab polls a little faster.
const FAMILY_REFRESH_MS = 20000;

function NotificationBanner({ userId }: { userId: string }) {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof Notification === 'undefined') return;
    setPermission(Notification.permission);
    if (Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then(reg =>
        reg.pushManager.getSubscription().then(sub => setSubscribed(!!sub))
      );
    }
  }, []);

  if (Platform.OS !== 'web' || permission === null || subscribed) return null;

  async function enable() {
    setBusy(true); setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;
      const res = await fetch('/api/push/vapid-key');
      if (!res.ok) throw new Error('Push not configured on server');
      const { publicKey } = await res.json();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subscription: sub.toJSON() }),
      });
      if (!saveRes.ok) throw new Error('Failed to save subscription');
      setSubscribed(true);
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (permission === 'denied') {
    return (
      <View style={bannerStyles.banner}>
        <Text style={bannerStyles.icon}>🔕</Text>
        <Text style={bannerStyles.text}>Notifications blocked — enable in browser settings.</Text>
      </View>
    );
  }

  return (
    <View style={bannerStyles.banner}>
      <Text style={bannerStyles.icon}>🔔</Text>
      <View style={bannerStyles.body}>
        <Text style={bannerStyles.text}>Get notified when someone joins</Text>
        {error && <Text style={bannerStyles.errorText}>{error}</Text>}
      </View>
      <TouchableOpacity
        style={[bannerStyles.btn, busy && bannerStyles.btnBusy]}
        onPress={enable} disabled={busy} activeOpacity={0.8}
      >
        {busy ? <ActivityIndicator color="#F5EDD6" size="small" /> : <Text style={bannerStyles.btnText}>Enable</Text>}
      </TouchableOpacity>
    </View>
  );
}

type Role = 'guest' | 'staff' | 'admin';
type TabKey = 'people' | 'events' | 'rooms';

type FamilyMember = {
  id: string;
  name: string;
  isAdmin: boolean;
  role: Role;
  arriveDate: string | null;
  arriveSlot: string | null;
  departDate: string | null;
  departSlot: string | null;
  aperitif: string | null;
  saveLunch?: boolean | null;
  saveDinner?: boolean | null;
  avatar?: string | null;
  pickupNeeded?: boolean | null;
  pickupTime?: string | null;
  pickupFrom?: string | null;
  dropoffNeeded?: boolean | null;
  dropoffTime?: string | null;
  dropoffTo?: string | null;
  visitStatus?: 'coming' | 'not_coming' | 'undecided' | null;
  room?: string | null;            // legacy single-room (kept for the shim)
  allocations?: Allocation[] | null; // date-ranged room segments (source of truth)
  isOwner?: boolean | null;
  isTest?: boolean | null;
};

// A placed room-allocation segment on the timeline (one person, one room, a range).
type RoomSeg = { memberId: string; name: string; avatar?: string | null; start: string; end: string };

type ChateauEvent = {
  id: string;
  eventDate: string;
  title: string;
  eventTime: string | null;
  createdAt: string;
};

const ROLE_CONFIG: Record<Role, { label: string; bg: string; border: string; text: string }> = {
  guest: { label: 'Guest',  bg: '#FFF8EE', border: '#C8973D', text: '#8B6245' },
  staff: { label: 'Staff',  bg: '#EEF4F8', border: '#3A6B8A', text: '#3A6B8A' },
  admin: { label: 'Admin',  bg: '#EEF6EE', border: '#2D5A3D', text: '#2D5A3D' },
};

type PendingUser = {
  id: string;
  name: string;
  createdAt: string;
  isAdmin: boolean;
};

function timeAgo(dateStr: string) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const BEFORE_DINNER_SLOTS = new Set(['morning', 'lunchtime', 'afternoon']);

function getDinnerStatus(member: FamilyMember, date: string): 'yes' | 'keep' | 'no' {
  if (!member.arriveDate || !member.departDate) return 'no';
  const arrive = String(member.arriveDate).slice(0, 10);
  const depart = String(member.departDate).slice(0, 10);
  if (date < arrive || date > depart) return 'no';
  if (date === depart && BEFORE_DINNER_SLOTS.has(member.departSlot ?? '')) return 'no';
  if (date === arrive) {
    if (member.arriveSlot === 'evening') return member.saveDinner ? 'keep' : 'no';
    if (member.arriveSlot === 'dinnertime') return member.saveDinner ? 'keep' : 'yes';
  }
  return 'yes';
}

function getLunchStatus(member: FamilyMember, date: string): 'yes' | 'keep' | 'no' {
  if (!member.arriveDate || !member.departDate) return 'no';
  const arrive = String(member.arriveDate).slice(0, 10);
  const depart = String(member.departDate).slice(0, 10);
  if (date < arrive || date > depart) return 'no';
  if (date === depart && member.departSlot === 'morning') return 'no';
  if (date === arrive) {
    if (member.arriveSlot === 'afternoon' || member.arriveSlot === 'dinnertime' || member.arriveSlot === 'evening') return 'no';
    if (member.arriveSlot === 'lunchtime') return (member.saveLunch ?? false) ? 'keep' : 'yes';
  }
  return 'yes';
}

// Escape user-controlled values before interpolating into the print HTML documents.
const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// Lunch & dinner grids over a selectable date range (guests × days). Wide ranges
// fit the page width via table-layout:fixed and flow onto extra pages vertically.
// Web-only (window.open + print).
function printDinnerGrid(members: FamilyMember[], fromDate: string, toDate: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (fromDate > toDate) { const t = fromDate; fromDate = toDate; toDate = t; }
  const days = datesBetween(fromDate, toDate);
  const today = todayStr();
  const dObj = (d: string) => new Date(d + 'T12:00:00');
  const isWeekend = (d: string) => { const g = dObj(d).getDay(); return g === 0 || g === 6; };
  const wd = (d: string) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dObj(d).getDay()];

  // Only guests present for at least one day in the range (skip staff + no-shows).
  const guests = members.filter(m =>
    m.role !== 'staff' && m.arriveDate && m.departDate
    && String(m.arriveDate).slice(0, 10) <= toDate && String(m.departDate).slice(0, 10) >= fromDate);

  const bands: { label: string; span: number }[] = [];
  days.forEach(d => {
    const label = dObj(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.span++;
    else bands.push({ label, span: 1 });
  });
  const monthHeader = bands.map(b => `<th colspan="${b.span}" class="month">${escapeHtml(b.label)}</th>`).join('');
  const dayHeader = days.map(d => {
    const cls = ['dc', isWeekend(d) ? 'we' : '', d === today ? 'td' : ''].filter(Boolean).join(' ');
    return `<th class="${cls}"><span class="wd">${wd(d)}</span><span class="dn">${dObj(d).getDate()}</span></th>`;
  }).join('');

  const bodyRows = (statusFn: (m: FamilyMember, d: string) => 'yes' | 'keep' | 'no') =>
    guests.map(m => {
      const cells = days.map(d => {
        const s = statusFn(m, d);
        const cls = ['dc', isWeekend(d) ? 'we' : '', d === today ? 'td' : '',
          s === 'yes' ? 'yes' : s === 'keep' ? 'keep' : ''].filter(Boolean).join(' ');
        return `<td class="${cls}">${s === 'keep' ? 'K' : ''}</td>`;
      }).join('');
      return `<tr><td class="name">${escapeHtml(m.name)}</td>${cells}</tr>`;
    }).join('');

  const totalsRow = (statusFn: (m: FamilyMember, d: string) => 'yes' | 'keep' | 'no') => {
    const cells = days.map(d => {
      const n = guests.filter(m => statusFn(m, d) !== 'no').length;
      const cls = ['dc', isWeekend(d) ? 'we' : '', d === today ? 'td' : '', 'total'].filter(Boolean).join(' ');
      return `<td class="${cls}">${n || ''}</td>`;
    }).join('');
    return `<tr><td class="name total">Total</td>${cells}</tr>`;
  };

  const table = (title: string, statusFn: (m: FamilyMember, d: string) => 'yes' | 'keep' | 'no') => `
    <p class="section-title">${title}</p>
    <table>
      <colgroup><col class="name">${days.map(() => '<col>').join('')}</colgroup>
      <thead>
        <tr><th rowspan="2" class="name"></th>${monthHeader}</tr>
        <tr>${dayHeader}</tr>
      </thead>
      <tbody>${bodyRows(statusFn)}${totalsRow(statusFn)}</tbody>
    </table>`;

  const rangeLabel = `${dObj(fromDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – `
    + `${dObj(toDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Meals — Les Joyeux</title><style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#1A1209;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{text-align:center;border-bottom:2px solid #C8973D;padding-bottom:8px;margin-bottom:8px}
.fleur{font-size:18px;color:#C8973D;display:block;margin-bottom:2px}
h1{font-size:18px;font-style:italic;font-family:Georgia,serif;margin-bottom:2px}
.subtitle{font-size:11px;color:#8B6245}
.section-title{font-size:12px;font-weight:700;color:#8B6245;margin:10px 0 4px}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:6px}
col.name{width:32mm}
th,td{border:1px solid #E7D6A8;font-size:8px;text-align:center;overflow:hidden}
thead th{background:#FAF6EC;color:#8B6245;font-weight:700}
.month{font-size:9px;border-bottom:1px solid #C8973D;padding:2px}
.dc{height:15px;padding:1px 0}
.wd{display:block;font-size:7px;color:#8B6245}
.dn{display:block;font-size:9px;font-weight:700;color:#1A1209}
.name{text-align:left;padding:3px 6px;font-size:9px;font-weight:600;white-space:nowrap;background:#fff}
.we{background:#E7E8EC}
.td{box-shadow:inset 2px 0 0 #C85A2E}
.yes{background:#2D5A3D}
.keep{background:#C8973D;color:#fff;font-weight:700}
.total{font-weight:700;background:#F0EBE0;color:#2D5A3D}
tbody tr{page-break-inside:avoid}
.legend{margin-top:8px;display:flex;gap:16px;justify-content:center;font-size:10px;color:#8B6245}
.legend-item{display:flex;align-items:center;gap:5px}
.sw{width:12px;height:11px;border-radius:2px;display:inline-block;border:1px solid #ddd}
footer{margin-top:8px;text-align:center;font-size:9px;color:#B8956A}
.close-btn{display:block;margin:14px auto 0;padding:8px 22px;background:#2D5A3D;color:#F5EDD6;border:none;border-radius:50px;font-size:13px;font-weight:700;cursor:pointer}
@media print{.close-btn{display:none}}
</style></head><body>
<header>
  <span class="fleur">✸</span>
  <h1>Meals</h1>
  <p class="subtitle">${rangeLabel}</p>
</header>
${table('🥗 Lunch', getLunchStatus)}
${table('🍷 Dinner', getDinnerStatus)}
<div class="legend">
  <div class="legend-item"><span class="sw" style="background:#2D5A3D"></span> Present</div>
  <div class="legend-item"><span class="sw" style="background:#C8973D"></span> Keep plate (K)</div>
  <div class="legend-item"><span class="sw" style="background:#E7E8EC"></span> Weekend</div>
</div>
<footer>Les Joyeux</footer>
<button class="close-btn" onclick="window.close()">Close</button>
<script>window.focus();window.print();<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=1100,height=760');
  if (w) { w.document.write(html); w.document.close(); }
}

// Per-evening apéritif tally across a date range — one compact card per evening
// (drink + count for whoever's there that night), flowed into columns. Web-only.
function printAperitifs(members: FamilyMember[], fromDate: string, toDate: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (fromDate > toDate) { const t = fromDate; fromDate = toDate; toDate = t; }
  const days = datesBetween(fromDate, toDate);
  const dObj = (d: string) => new Date(d + 'T12:00:00');

  // Who is here for the apéritif on a given evening (mirrors the Tonight card).
  const presentOn = (d: string) => members.filter(m => {
    if (!m.arriveDate || !m.departDate) return false;
    const a = String(m.arriveDate).slice(0, 10), dep = String(m.departDate).slice(0, 10);
    if (d < a || d > dep) return false;
    if (d === dep && BEFORE_DINNER_SLOTS.has(m.departSlot ?? '')) return false; // gone before the evening
    return true;
  });

  const cards = days.map(d => {
    const present = presentOn(d);
    if (present.length === 0) return '';
    const counts: Record<string, number> = {};
    present.forEach(m => { const k = m.aperitif ?? '__undecided__'; counts[k] = (counts[k] ?? 0) + 1; });
    const rows = Object.entries(counts).sort(([, a], [, b]) => b - a).map(([k, c]) => {
      const isU = k === '__undecided__';
      const icon = isU ? '🎲' : (DRINK_ICONS[k] ?? '🍷');
      const label = isU ? 'Undecided' : (DRINK_LABELS[k] ?? k);
      return `<div class="drow"><span class="di">${icon}</span><span class="dl">${escapeHtml(label)}</span><span class="dn">\xd7${c}</span></div>`;
    }).join('');
    const dateLbl = dObj(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<div class="card"><div class="ch">${dateLbl}<span class="chc">${present.length}</span></div>${rows}</div>`;
  }).join('');

  const rangeLabel = `${dObj(fromDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – `
    + `${dObj(toDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const body = cards || `<p class="none">No one is here for an apéritif in this range.</p>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Apéritifs — Les Joyeux</title><style>
@page{size:A4 portrait;margin:14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;color:#1A1209;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{text-align:center;border-bottom:2px solid #C8973D;padding-bottom:14px;margin-bottom:16px}
.fleur{font-size:24px;color:#C8973D;display:block;margin-bottom:6px}
h1{font-size:26px;font-style:italic;margin-bottom:4px}
.subtitle{font-family:Arial,sans-serif;font-size:12px;color:#8B6245}
.cards{column-width:58mm;column-gap:8mm}
.card{break-inside:avoid;border:1px solid #EDD9A3;border-radius:8px;padding:8px 10px;margin-bottom:8px;display:inline-block;width:100%}
.ch{display:flex;justify-content:space-between;align-items:center;font-family:Arial,sans-serif;font-weight:700;font-size:12px;color:#8B6245;border-bottom:1px solid #EDD9A3;padding-bottom:4px;margin-bottom:6px}
.chc{background:#2D5A3D;color:#F5EDD6;border-radius:10px;padding:0 7px;font-size:10px}
.drow{display:flex;align-items:center;gap:6px;padding:2px 0}
.di{font-size:16px;width:22px;text-align:center}
.dl{flex:1;font-style:italic;font-size:13px}
.dn{font-family:Arial,sans-serif;font-weight:700;color:#2D5A3D;font-size:13px}
.none{text-align:center;color:#8B6245;font-style:italic;margin-top:20px}
footer{margin-top:16px;border-top:1px solid #EDD9A3;padding-top:10px;text-align:center;font-family:Arial,sans-serif;font-size:10px;color:#B8956A}
.close-btn{display:block;margin:18px auto 0;padding:9px 26px;background:#2D5A3D;color:#F5EDD6;border:none;border-radius:50px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;cursor:pointer}
@media print{.close-btn{display:none}}
</style></head><body>
<header><span class="fleur">✸</span><h1>Apéritifs</h1>
<p class="subtitle">${rangeLabel}</p></header>
<div class="cards">${body}</div>
<footer>Les Joyeux</footer>
<button class="close-btn" onclick="window.close()">Close</button>
<script>window.focus();window.print();<\/script>
</body></html>`;
  const w = window.open('', '_blank', 'width=900,height=720');
  if (w) { w.document.write(html); w.document.close(); }
}

// Printable room-occupancy grid — mirrors the on-screen Rooms timeline.
// One row per room; each day cell is shaded by how many people are in that room
// (1 / 2 / 3+), with the count shown when ≥2. Rooms are ordered exactly as the
// timeline orders them (earliest-occupied first; unoccupied rooms last in
// master-list order). `hideEmpty` drops rooms with no one staying in the range.
// Scales to fit a single A4 landscape page. Web-only (window.open + print).
function printRoomAllocation(
  members: FamilyMember[],
  fromDate: string,
  toDate: string,
  hideEmpty: boolean,
) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (fromDate > toDate) { const t = fromDate; fromDate = toDate; toDate = t; }

  const days = datesBetween(fromDate, toDate);
  const today = todayStr();
  const dObj = (d: string) => new Date(d + 'T12:00:00');
  const isWeekend = (d: string) => { const g = dObj(d).getDay(); return g === 0 || g === 6; };
  const firstName = (n: string) => n.trim().split(/\s+/)[0];

  // Per-room segments overlapping the range (one entry per person-stay in a room,
  // so a person who moves appears in two rooms).
  const occByRoom: Record<string, { name: string; a: string; d: string }[]> = {};
  ROOMS.forEach(r => { occByRoom[r.key] = []; });
  members.forEach(m => {
    allocationsForMember(m.allocations, m).forEach(s => {
      if (s.start <= toDate && s.end >= fromDate && occByRoom[s.room]) {
        occByRoom[s.room].push({ name: m.name, a: s.start, d: s.end });
      }
    });
  });
  Object.values(occByRoom).forEach(occ =>
    occ.sort((x, y) => (x.a !== y.a ? (x.a < y.a ? -1 : 1) : (x.name < y.name ? -1 : 1))));

  // Bed turns over when a segment starts while a DIFFERENT person's segment ends
  // the day before or the same day (matches the on-screen changeover rule).
  const changeoverOf = (occ: { name: string; a: string; d: string }[]) => {
    const marks = new Set<string>();
    occ.forEach(s => {
      const prev = addDays(s.a, -1);
      if (occ.some(o => o.name !== s.name && (o.d === prev || o.d === s.a))) marks.add(s.a);
    });
    return marks;
  };

  // Same ordering as the on-screen timeline: earliest first-arrival wins; rooms
  // with occupants sink above empty ones; ties fall back to master-list order.
  const firstArrival: Record<string, string> = {};
  Object.entries(occByRoom).forEach(([k, occ]) => {
    if (occ.length) firstArrival[k] = occ.reduce((a, b) => (a.a < b.a ? a : b)).a;
  });
  const idx = Object.fromEntries(ROOMS.map((r, i) => [r.key, i]));
  const ordered = [...ROOMS].sort((a, b) => {
    const fa = firstArrival[a.key], fb = firstArrival[b.key];
    if (fa && fb) return fa !== fb ? (fa < fb ? -1 : 1) : idx[a.key] - idx[b.key];
    if (fa) return -1;
    if (fb) return 1;
    return idx[a.key] - idx[b.key];
  });

  const shadeClass = (n: number) => (n >= 3 ? 'b3' : n === 2 ? 'b2' : 'b1');

  // Month bands across the day columns (colspan per contiguous month).
  const bands: { label: string; span: number }[] = [];
  days.forEach(d => {
    const label = dObj(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.span++;
    else bands.push({ label, span: 1 });
  });
  const monthHeader = bands.map(b => `<th colspan="${b.span}" class="month">${escapeHtml(b.label)}</th>`).join('');
  const dayHeader = days.map(d => {
    const cls = ['dc', isWeekend(d) ? 'we' : '', d === today ? 'td' : ''].filter(Boolean).join(' ');
    return `<th class="${cls}">${dObj(d).getDate()}</th>`;
  }).join('');

  let shownRooms = 0;
  const bodyRows = ordered.map(room => {
    const occ = occByRoom[room.key];
    if (hideEmpty && occ.length === 0) return '';
    shownRooms++;
    const owner = 'owner' in room ? room.owner : null;
    const marks = changeoverOf(occ);
    const who = occ.length
      ? [...new Set(occ.map(o => firstName(o.name)))].map(escapeHtml).join(', ')
      : '<span class="empty">— free —</span>';
    const cells = days.map(d => {
      const n = occ.filter(o => o.a <= d && d <= o.d).length;
      const arr = occ.some(o => o.a === d); // someone arrives here today
      const dep = occ.some(o => o.d === d); // someone departs here today
      const cls = [
        'dc',
        isWeekend(d) ? 'we' : '',
        n > 0 ? shadeClass(n) : '',
        arr ? 'arr' : '',
        dep ? 'dep' : '',
        marks.has(d) ? 'chg' : '',
        d === today ? 'td' : '',
      ].filter(Boolean).join(' ');
      return `<td class="${cls}">${n >= 1 ? n : ''}</td>`;
    }).join('');
    const roomCell = `<td class="room"><span class="rn">${escapeHtml(room.label)}</span>`
      + (owner ? `<span class="ro">${escapeHtml(owner)}'s</span>` : '') + `</td>`;
    return `<tr>${roomCell}<td class="who">${who}</td>${cells}</tr>`;
  }).join('');

  const rangeLabel = `${dObj(fromDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – `
    + `${dObj(toDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const roomsNote = hideEmpty ? `${shownRooms} occupied room${shownRooms === 1 ? '' : 's'}` : `all rooms`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Room Allocation — Les Joyeux</title><style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body{font-family:Arial,sans-serif;color:#1A1209;-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* #page is exactly the landscape print area; #sheet is scaled to fit inside it,
   so the table can never spill onto a second page. */
#page{width:281mm;height:194mm;overflow:hidden}
#sheet{width:281mm;transform-origin:top left}
header{text-align:center;border-bottom:2px solid #C8973D;padding-bottom:8px;margin-bottom:10px}
.fleur{font-size:18px;color:#C8973D;display:block;margin-bottom:2px}
h1{font-size:18px;font-style:italic;font-family:Georgia,serif;margin-bottom:2px}
.subtitle{font-size:11px;color:#8B6245}
table{width:100%;border-collapse:collapse;table-layout:fixed}
col.room{width:26mm}col.who{width:40mm}
th,td{border:1px solid #E7D6A8;font-size:9px;overflow:hidden;text-align:center}
thead th{background:#FAF6EC;color:#8B6245;font-weight:700}
.month{font-size:10px;padding:3px 2px;border-bottom:1px solid #C8973D}
.dc{padding:3px 0;height:18px;font-weight:700;color:#4A2E12}
/* Order matters: weekend (lowest) < occupancy shade < arrival/departure.
   Later rules of equal specificity win, so arr/dep override the shade. */
.we{background:#E7E8EC}
.b1{background:#EAD3A7}.b2{background:#D99C5B}.b3{background:#C97C3D}
.arr{background:#B5D6A7}.dep{background:#E9BDB0}
.arr.dep{background:linear-gradient(90deg,#B5D6A7 50%,#E9BDB0 50%)}
.chg{border-left:2px dashed #5C3D2E}
.td{box-shadow:inset 2px 0 0 #C85A2E}
.room{text-align:left;padding:5px 6px;vertical-align:middle;background:#fff}
.rn{display:block;font-size:11px;font-weight:700;color:#1A1209}
.ro{display:block;font-size:9px;color:#8B6245}
.who{text-align:left;padding:4px 6px;font-size:9px;color:#5C3D2E;background:#FFFDF5;line-height:1.3}
.who .empty{color:#B8A98A;font-style:italic}
footer{margin-top:10px;text-align:center;font-size:9px;color:#B8956A}
.legend{margin-top:8px;display:flex;gap:14px;justify-content:center;align-items:center;font-size:10px;color:#8B6245}
.sw{display:inline-block;width:14px;height:11px;border-radius:2px;border:1px solid #ddd;vertical-align:middle;margin-right:4px}
.hint{margin-top:6px;text-align:center;font-size:9px;color:#8B6245}
.close-btn{display:block;margin:14px auto 0;padding:8px 22px;background:#2D5A3D;color:#F5EDD6;border:none;border-radius:50px;font-size:13px;font-weight:700;cursor:pointer}
@media print{.close-btn,.hint{display:none}}
</style></head><body>
<div id="page"><div id="sheet">
<header>
  <span class="fleur">✸</span>
  <h1>Room Allocation</h1>
  <p class="subtitle">${rangeLabel}  ·  ${roomsNote}</p>
</header>
<table>
  <colgroup><col class="room"><col class="who">${days.map(() => '<col>').join('')}</colgroup>
  <thead>
    <tr><th rowspan="2" class="room">Room</th><th rowspan="2" class="who">Who</th>${monthHeader}</tr>
    <tr>${dayHeader}</tr>
  </thead>
  <tbody>${bodyRows}</tbody>
</table>
<div class="legend">
  <span><span class="sw" style="background:#EAD3A7"></span>1</span>
  <span><span class="sw" style="background:#D99C5B"></span>2</span>
  <span><span class="sw" style="background:#C97C3D"></span>3+ sharing</span>
  <span><span class="sw" style="background:#B5D6A7"></span>arrives</span>
  <span><span class="sw" style="background:#E9BDB0"></span>departs</span>
  <span><span class="sw" style="border-left:2px dashed #5C3D2E;background:#fff"></span>🛏 changeover</span>
  <span>· number = people in room · today marked orange</span>
</div>
<footer>Les Joyeux</footer>
</div></div>
<p class="hint">Prints on one landscape page — if the dialog opens in portrait, choose Landscape.</p>
<button class="close-btn" onclick="window.close()">Close</button>
<script>
window.onload=function(){
  var sheet=document.getElementById('sheet');
  var h_mm=sheet.getBoundingClientRect().height*25.4/96; // CSS px -> mm
  var s=Math.min(1, 194/h_mm);                            // fit the 194mm page height
  if(s<1){ sheet.style.transform='scale('+s+')'; }
  window.focus(); window.print();
};
<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=1100,height=760');
  if (w) { w.document.write(html); w.document.close(); }
}

const BELL_COOLDOWN_MS = 5 * 60 * 1000;

type BellType = 'lunch' | 'aperitif' | 'dinner' | 'custom';

const BELL_PRESETS: Record<Exclude<BellType, 'custom'>, { icon: string; label: string; title: string; body: string }> = {
  lunch:    { icon: '🔔', label: 'Ring the lunch bell',    title: '🔔 Lunch is ready!',    body: 'À table — come to lunch' },
  aperitif: { icon: '🥂', label: 'Ring for apéritifs',     title: '🥂 Apéritifs!',          body: 'Come join us for drinks' },
  dinner:   { icon: '🍽', label: 'Ring the dinner bell',   title: '🍽 Dinner is ready!',    body: 'À table — dinner is served' },
};

function currentBellType(): BellType {
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  if (m >= 715  && m < 870)  return 'lunch';     // 11:55–14:30
  if (m >= 1105 && m < 1200) return 'aperitif';  // 18:25–20:00
  if (m >= 1195 && m < 1320) return 'dinner';    // 19:55–22:00
  return 'custom';
}

function BellCard({ userId }: { userId: string }) {
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [ringing,   setRinging]    = useState(false);
  const [customMsg, setCustomMsg]  = useState('');
  const [now,       setNow]        = useState(() => new Date());
  const [error,     setError]      = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useFocusEffect(useCallback(() => {
    fetch('/api/push/bell', { headers: { 'x-user-id': userId } })
      .then(r => r.json())
      .then(d => { if (d.lastSentAt) setLastSentAt(new Date(d.lastSentAt)); })
      .catch(() => {});
  }, [userId]));

  const type    = currentBellType();
  const preset  = type !== 'custom' ? BELL_PRESETS[type] : null;
  const elapsed = lastSentAt ? now.getTime() - lastSentAt.getTime() : BELL_COOLDOWN_MS;
  const remaining   = Math.max(0, BELL_COOLDOWN_MS - elapsed);
  const onCooldown  = remaining > 0;
  const cooldownStr = onCooldown
    ? `${Math.floor(remaining / 60000)}:${String(Math.ceil((remaining % 60000) / 1000)).padStart(2, '0')}`
    : null;

  async function ring() {
    const title = preset ? preset.title : customMsg.trim();
    const body  = preset ? preset.body  : '';
    if (!title) return;
    setRinging(true); setError(null);
    try {
      const res = await fetch('/api/push/bell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ title, body }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setLastSentAt(new Date(data.lastSentAt));
      } else if (res.ok) {
        setLastSentAt(new Date(data.sentAt));
        if (type === 'custom') setCustomMsg('');
      } else {
        setError(data.error ?? 'Failed to send');
      }
    } catch {
      setError('Network error');
    } finally {
      setRinging(false);
    }
  }

  const canRing = !onCooldown && !ringing && (type !== 'custom' || customMsg.trim().length > 0);

  return (
    <View style={styles.bellCard}>
      {type === 'custom' && (
        <TextInput
          style={styles.bellInput}
          placeholder="Type a message to send…"
          placeholderTextColor="#B8956A"
          value={customMsg}
          onChangeText={setCustomMsg}
          returnKeyType="send"
          onSubmitEditing={canRing ? ring : undefined}
        />
      )}
      <View style={styles.bellRow}>
        <View style={{ flex: 1 }}>
          {onCooldown ? (
            <Text style={styles.bellCooldown}>🔕 Available again in {cooldownStr}</Text>
          ) : (
            <Text style={styles.bellLabel}>{preset?.icon ?? '📢'} {preset?.label ?? 'Send a message'}</Text>
          )}
          {error && <Text style={styles.bellError}>{error}</Text>}
        </View>
        <TouchableOpacity
          style={[styles.bellBtn, !canRing && styles.bellBtnDisabled]}
          onPress={ring}
          disabled={!canRing}
          activeOpacity={0.8}
        >
          {ringing
            ? <ActivityIndicator color="#F5EDD6" size="small" />
            : <Text style={styles.bellBtnText}>Ring</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TonightSummaryCard({ members }: { members: FamilyMember[] }) {
  // Print dialog (meals + apéritifs share one date-range modal).
  const [printMode, setPrintMode] = useState<null | 'meals' | 'aperitifs'>(null);
  const [pFrom, setPFrom] = useState('');
  const [pTo, setPTo] = useState('');
  const mealSpan = useMemo(() => {
    const withDates = members.filter(m => m.arriveDate && m.departDate);
    if (!withDates.length) { const t = todayStr(); return { from: t, to: t }; }
    const arrs = withDates.map(m => String(m.arriveDate).slice(0, 10));
    const deps = withDates.map(m => String(m.departDate).slice(0, 10));
    return { from: arrs.reduce((a, b) => (a < b ? a : b)), to: deps.reduce((a, b) => (a > b ? a : b)) };
  }, [members]);
  const openPrint = (mode: 'meals' | 'aperitifs') => { setPFrom(mealSpan.from); setPTo(mealSpan.to); setPrintMode(mode); };

  const today = todayStr();
  const hereTonight = members.filter(m => {
    if (!m.arriveDate || !m.departDate) return false;
    if (today < m.arriveDate || today > m.departDate) return false;
    if (today === String(m.departDate).slice(0, 10) && BEFORE_DINNER_SLOTS.has(m.departSlot ?? '')) return false;
    return true;
  });

  const nonStaff = members.filter(m => m.role !== 'staff');
  const lunchCount  = nonStaff.filter(m => getLunchStatus(m, today) !== 'no').length;
  const dinnerCount = nonStaff.filter(m => getDinnerStatus(m, today) !== 'no').length;

  const counts: Record<string, number> = {};
  for (const m of hereTonight) {
    const key = m.aperitif ?? '__undecided__';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);

  return (
    <>
      <View style={styles.dinnerRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.dinnerRowText}>
            {'🥗 '}{lunchCount === 0 ? 'Nobody for lunch today' : `${lunchCount} ${lunchCount === 1 ? 'person' : 'people'} for lunch today`}
          </Text>
          <Text style={styles.dinnerRowText}>
            {'🍽 '}{dinnerCount === 0 ? 'Nobody for dinner tonight' : `${dinnerCount} ${dinnerCount === 1 ? 'person' : 'people'} for dinner tonight`}
          </Text>
        </View>
        {Platform.OS === 'web' && (
          <TouchableOpacity onPress={() => openPrint('meals')} activeOpacity={0.7} style={styles.dinnerPrintBtn}>
            <Text style={styles.dinnerPrintBtnText}>🖨</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={[styles.summaryCard, { marginTop: 4 }]}>
        <View style={styles.summaryCardTitleRow}>
          <Text style={styles.summaryCardTitle}>🍹 Tonight's aperitifs</Text>
          {Platform.OS === 'web' && (
            <TouchableOpacity onPress={() => openPrint('aperitifs')} activeOpacity={0.7} style={styles.dinnerPrintBtn}>
              <Text style={styles.dinnerPrintBtnText}>🖨</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.summaryCardSub}>
          {hereTonight.length === 0 ? 'Nobody here tonight' : `${hereTonight.length} ${hereTonight.length === 1 ? 'person' : 'people'} here tonight`}
        </Text>
        {rows.length > 0 && (
          <View style={styles.summaryCardRows}>
            {rows.map(([key, count]) => {
              const isUndecided = key === '__undecided__';
              const icon = isUndecided ? '🎲' : (DRINK_ICONS[key] ?? '🍷');
              const label = isUndecided ? 'Undecided' : (DRINK_LABELS[key] ?? key);
              return (
                <View key={key} style={styles.summaryCardRow}>
                  <Text style={styles.summaryCardIcon}>{icon}</Text>
                  <Text style={styles.summaryCardLabel}>{label}</Text>
                  <View style={styles.summaryCardBadge}>
                    <Text style={styles.summaryCardBadgeText}>×{count}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <DateRangePrintModal
        visible={printMode !== null}
        title={printMode === 'meals' ? 'Print meals' : 'Print apéritifs'}
        intro={printMode === 'meals'
          ? 'Lunch & dinner grid for the dates below. Defaults to the whole summer.'
          : 'Apéritif choices per evening for the dates below. Defaults to the whole summer.'}
        from={pFrom}
        to={pTo}
        onChangeFrom={setPFrom}
        onChangeTo={setPTo}
        onPrint={() => {
          if (printMode === 'meals') printDinnerGrid(members, pFrom, pTo);
          else if (printMode === 'aperitifs') printAperitifs(members, pFrom, pTo);
          setPrintMode(null);
        }}
        onClose={() => setPrintMode(null)}
      />
    </>
  );
}

function MemberCard({
  member,
  managing,
  onRemove,
  removing,
  onRoleChange,
  changingRole,
  canGrantAdmin,
  onOwnerToggle,
  changingOwner,
  onRoomPress,
  roomBusy,
  onDatesPress,
  datesBusy,
  onPress,
}: {
  member: FamilyMember;
  managing?: boolean;
  onRemove?: () => void;
  removing?: boolean;
  onRoleChange?: (role: Role) => void;
  changingRole?: boolean;
  canGrantAdmin?: boolean;
  onOwnerToggle?: (makeOwner: boolean) => void;
  changingOwner?: boolean;
  onRoomPress?: () => void;
  roomBusy?: boolean;
  onDatesPress?: () => void;
  datesBusy?: boolean;
  onPress?: () => void;
}) {
  const today = todayStr();
  const hasVisit = !!(member.arriveDate && member.departDate);
  const isHere   = hasVisit && today >= member.arriveDate! && today <= member.departDate!;
  const isFuture = hasVisit && today < member.arriveDate!;
  const segs = hasVisit ? allocationsForMember(member.allocations, member) : [];
  const currentSeg = segs.find(s => today >= s.start && today <= s.end) ?? segs[0] ?? null;
  const roomSummary = segs.length === 0 ? 'Assign'
    : segs.length === 1 ? roomLabel(segs[0].room)
    : `${segs.length} rooms`;
  const drinkIcon = member.aperitif ? (DRINK_ICONS[member.aperitif] ?? null) : null;

  const roleConf = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.guest;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.card, (managing && (onRoleChange || onRoomPress || onDatesPress)) && { flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}
    >
      {/* Main row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {member.avatar
          ? <Image source={{ uri: member.avatar }} style={styles.avatarImg} />
          : <View style={[styles.avatar, { backgroundColor: avatarColor(member.name) }]}>
              <Text style={styles.avatarText}>{initials(member.name)}</Text>
            </View>
        }

        <View style={styles.memberInfo}>
          <View style={styles.memberNameRow}>
            <Text style={styles.memberName}>{member.name}</Text>
            {member.isTest && (
              <View style={styles.testBadge}><Text style={styles.testBadgeText}>test</Text></View>
            )}
            {managing && (
              <View style={[styles.roleBadge, { backgroundColor: roleConf.bg, borderColor: roleConf.border }]}>
                <Text style={[styles.roleBadgeText, { color: roleConf.text }]}>{roleConf.label}</Text>
              </View>
            )}
          </View>

          {isHere ? (
            <Text style={styles.visitHere}>● Here until {formatDate(member.departDate!)}</Text>
          ) : isFuture ? (
            <>
              <Text style={styles.visitFuture}>
                Arriving {formatDate(member.arriveDate!)}, {slotLabel(member.arriveSlot!)}
              </Text>
              <Text style={styles.visitLeaving}>
                Leaving {formatDate(member.departDate!)}, {slotLabel(member.departSlot!)}
              </Text>
            </>
          ) : member.visitStatus === 'not_coming' ? (
            <Text style={styles.visitNone}>Not coming this year</Text>
          ) : member.visitStatus === 'undecided' ? (
            <Text style={styles.visitNone}>Plans not finalised</Text>
          ) : (
            <Text style={styles.visitNone}>No upcoming visit</Text>
          )}
          {(isHere || isFuture) && member.pickupNeeded && (
            <Text style={styles.transportNote}>
              🚗 Pick up{member.pickupTime ? ` ${member.pickupTime}` : ''}{member.pickupFrom ? ` · ${member.pickupFrom}` : ''}
            </Text>
          )}
          {(isHere || isFuture) && member.dropoffNeeded && (
            <Text style={styles.transportNote}>
              🚗 Drop off{member.dropoffTime ? ` ${member.dropoffTime}` : ''}{member.dropoffTo ? ` · ${member.dropoffTo}` : ''}
            </Text>
          )}
          {(isHere || isFuture) && currentSeg && !managing && (
            <Text style={styles.roomNote}>
              🛏 {roomLabel(currentSeg.room)}{segs.length > 1 ? ` +${segs.length - 1}` : ''}
            </Text>
          )}
        </View>

        {drinkIcon && !managing && (
          <View style={styles.drinkBadgeWrap}>
            <Text style={styles.drinkBadge}>{drinkIcon}</Text>
            <Text style={styles.drinkBadgeLabel}>{DRINK_LABELS[member.aperitif!] ?? member.aperitif}</Text>
          </View>
        )}

        {managing && onRemove && (
          <TouchableOpacity
            style={[styles.removeBtn, removing && styles.removeBtnBusy]}
            onPress={onRemove}
            disabled={removing}
            activeOpacity={0.8}
          >
            {removing
              ? <ActivityIndicator color="#C85A2E" size="small" />
              : <Text style={styles.removeBtnText}>Remove</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {/* Role selector (+ owner) — manage mode only */}
      {managing && (onRoleChange || onOwnerToggle) && (
        <View style={styles.roleRow}>
          {onRoleChange && (['guest', 'staff', 'admin'] as Role[]).map(r => {
            const rc = ROLE_CONFIG[r];
            const active = member.role === r;
            // Only a site owner may grant or remove the admin role.
            const lockedAdmin = (r === 'admin' || member.role === 'admin') && !canGrantAdmin;
            const disabled = active || changingRole || lockedAdmin;
            return (
              <TouchableOpacity
                key={r}
                style={[
                  styles.roleChip,
                  active && { backgroundColor: rc.bg, borderColor: rc.border },
                  (changingRole || lockedAdmin) && { opacity: 0.5 },
                ]}
                onPress={() => !disabled && onRoleChange(r)}
                disabled={disabled}
                activeOpacity={0.7}
              >
                <Text style={[styles.roleChipText, active && { color: rc.text, fontWeight: '700' }]}>
                  {rc.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {onOwnerToggle && (
            <TouchableOpacity
              key="owner"
              style={[
                styles.roleChip,
                member.isOwner && styles.ownerChipActive,
                changingOwner && { opacity: 0.5 },
              ]}
              onPress={() => !changingOwner && onOwnerToggle(!member.isOwner)}
              disabled={changingOwner}
              activeOpacity={0.7}
            >
              <Text style={[styles.roleChipText, member.isOwner && styles.ownerChipTextActive]}>
                👑 Owner
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Arrival/departure dates — admin manage mode, fixes wrong data */}
      {managing && onDatesPress && (
        <TouchableOpacity style={styles.roomAssignRow} onPress={onDatesPress} disabled={datesBusy} activeOpacity={0.7}>
          <Text style={styles.roomAssignLabel}>📅 Dates</Text>
          <Text style={styles.roomAssignValue}>
            {hasVisit ? `${formatDate(member.arriveDate!)} → ${formatDate(member.departDate!)}` : 'Set dates'} ›
          </Text>
          {datesBusy && <ActivityIndicator size="small" color="#C85A2E" />}
        </TouchableOpacity>
      )}

      {/* Room allocation — admin manage mode, only for members with a dated visit */}
      {managing && onRoomPress && hasVisit && (
        <TouchableOpacity style={styles.roomAssignRow} onPress={onRoomPress} disabled={roomBusy} activeOpacity={0.7}>
          <Text style={styles.roomAssignLabel}>🛏 Rooms</Text>
          <Text style={styles.roomAssignValue}>{roomSummary} ›</Text>
          {roomBusy && <ActivityIndicator size="small" color="#C85A2E" />}
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function MemberDetailModal({ member, onClose }: { member: FamilyMember | null; onClose: () => void }) {
  if (!member) return null;
  const today = todayStr();
  const hasVisit = !!(member.arriveDate && member.departDate);
  const isHere   = hasVisit && today >= member.arriveDate! && today <= member.departDate!;
  const isFuture = hasVisit && today < member.arriveDate!;
  const roleConf = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.guest;
  const drinkIcon  = member.aperitif ? (DRINK_ICONS[member.aperitif]  ?? '🍷') : null;
  const drinkLabel = member.aperitif ? (DRINK_LABELS[member.aperitif] ?? member.aperitif) : null;
  const segs = hasVisit ? allocationsForMember(member.allocations, member) : [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.modalCard}>

          {/* Avatar + name + role */}
          <View style={styles.modalHeader}>
            {member.avatar
              ? <Image source={{ uri: member.avatar }} style={styles.modalAvatar} />
              : <View style={[styles.modalAvatarCircle, { backgroundColor: avatarColor(member.name) }]}>
                  <Text style={styles.modalAvatarText}>{initials(member.name)}</Text>
                </View>
            }
            <View style={{ flex: 1 }}>
              <Text style={styles.modalName}>{member.name}</Text>
              <View style={[styles.roleBadge, { backgroundColor: roleConf.bg, borderColor: roleConf.border, alignSelf: 'flex-start', marginTop: 4 }]}>
                <Text style={[styles.roleBadgeText, { color: roleConf.text }]}>{roleConf.label}</Text>
              </View>
            </View>
          </View>

          <View style={styles.modalDivider} />

          {hasVisit ? (
            <>
              {/* Arriving */}
              <View style={styles.modalSection}>
                <Text style={styles.modalEyebrow}>ARRIVING</Text>
                <Text style={styles.modalDateLine}>{formatDate(member.arriveDate!)}
                  <Text style={styles.modalSlot}>  {slotLabel(member.arriveSlot!)}</Text>
                </Text>
                {isHere && <Text style={styles.modalHereNow}>● Here now</Text>}
                {member.saveLunch  && <Text style={styles.modalNote}>🍽  Lunch plate saved</Text>}
                {member.saveDinner && <Text style={styles.modalNote}>🍽  Dinner plate saved</Text>}
                {member.pickupNeeded && (
                  <Text style={styles.modalTransport}>
                    🚗  Pick up{member.pickupTime ? ` at ${member.pickupTime}` : ''}{member.pickupFrom ? ` from ${member.pickupFrom}` : ''}
                  </Text>
                )}
              </View>

              <View style={styles.modalDivider} />

              {/* Leaving */}
              <View style={styles.modalSection}>
                <Text style={styles.modalEyebrow}>LEAVING</Text>
                <Text style={styles.modalDateLine}>{formatDate(member.departDate!)}
                  <Text style={styles.modalSlot}>  {slotLabel(member.departSlot!)}</Text>
                </Text>
                {member.dropoffNeeded && (
                  <Text style={styles.modalTransport}>
                    🚗  Drop off{member.dropoffTime ? ` at ${member.dropoffTime}` : ''}{member.dropoffTo ? ` to ${member.dropoffTo}` : ''}
                  </Text>
                )}
              </View>

              {/* Room(s) */}
              {segs.length > 0 && (
                <>
                  <View style={styles.modalDivider} />
                  <View style={styles.modalSection}>
                    <Text style={styles.modalEyebrow}>{segs.length > 1 ? 'ROOMS' : 'ROOM'}</Text>
                    {segs.map((s, i) => (
                      <Text key={i} style={styles.modalDateLine}>
                        🛏  {roomLabel(s.room)}
                        {segs.length > 1 && <Text style={styles.modalSlot}>  {formatDate(s.start)} – {formatDate(s.end)}</Text>}
                      </Text>
                    ))}
                  </View>
                </>
              )}

              {/* Apéritif */}
              {drinkIcon && (
                <>
                  <View style={styles.modalDivider} />
                  <View style={styles.modalSection}>
                    <Text style={styles.modalEyebrow}>APÉRITIF</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <Text style={{ fontSize: 28 }}>{drinkIcon}</Text>
                      <Text style={styles.modalDrinkLabel}>{drinkLabel}</Text>
                    </View>
                  </View>
                </>
              )}
            </>
          ) : (
            <View style={styles.modalSection}>
              <Text style={styles.modalNoVisit}>
                {member.visitStatus === 'not_coming'
                  ? 'Not coming this year'
                  : member.visitStatus === 'undecided'
                  ? 'Plans not finalised yet'
                  : 'No visit planned yet'}
              </Text>
            </View>
          )}

          <Text style={styles.modalDismissHint}>Tap outside to close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Edit a member's date-ranged room allocations (admin only): list segments, add,
// edit, or remove. `member` is looked up live by the parent so the list reflects
// the latest allocations after each mutation.
function SegmentEditorModal({ member, busy, onAdd, onUpdate, onRemove, onClose }: {
  member: FamilyMember | null;
  busy: boolean;
  onAdd: (seg: { room: string; start: string; end: string }) => void;
  onUpdate: (id: string, patch: { room: string; start: string; end: string }) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null); // 'new' | allocation id | null
  const [fRoom, setFRoom] = useState('');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const memberId = member?.id ?? null;
  useEffect(() => { setEditingId(null); setFRoom(''); setFStart(''); setFEnd(''); }, [memberId]);
  if (!member) return null;

  const stayStart = member.arriveDate ? String(member.arriveDate).slice(0, 10) : '';
  const stayEnd = member.departDate ? String(member.departDate).slice(0, 10) : '';
  const explicit = member.allocations ?? [];
  const segs = allocationsForMember(explicit, member);
  const isDefault = explicit.length === 0 && segs.length > 0; // synthesized owner default

  const openAdd = () => { setEditingId('new'); setFRoom(''); setFStart(stayStart); setFEnd(stayEnd); };
  const openEdit = (a: Allocation) => { setEditingId(a.id!); setFRoom(a.room); setFStart(a.start); setFEnd(a.end); };

  let error: string | null = null;
  if (editingId) {
    if (!fRoom) error = 'Pick a room';
    else if (!fStart || !fEnd) error = 'Pick both dates';
    else if (fEnd < fStart) error = 'End must be on or after start';
    else if (stayStart && fStart < stayStart) error = `Not before ${formatDate(stayStart)}`;
    else if (stayEnd && fEnd > stayEnd) error = `Not after ${formatDate(stayEnd)}`;
    else if (explicit.filter(a => a.id !== editingId).some(o => segmentsOverlap({ start: fStart, end: fEnd }, o)))
      error = 'That overlaps another of their rooms';
  }
  const canSave = !!editingId && !error && !busy;
  const save = () => {
    if (!canSave) return;
    if (editingId === 'new') onAdd({ room: fRoom, start: fStart, end: fEnd });
    else onUpdate(editingId!, { room: fRoom, start: fStart, end: fEnd });
    setEditingId(null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomSheet}>
          <Text style={styles.roomSheetTitle}>Rooms for {member.name.split(' ')[0]}</Text>
          {stayStart && stayEnd && (
            <Text style={styles.printIntro}>Stay: {formatDate(stayStart)} – {formatDate(stayEnd)}</Text>
          )}
          <ScrollView style={{ maxHeight: 420 }}>
            {isDefault && (
              <View style={styles.segDefaultRow}>
                <Text style={styles.segDefaultText}>
                  Auto: {roomLabel(segs[0].room)} (owned room) — add a segment to override.
                </Text>
              </View>
            )}
            {explicit.map(a => (
              <View key={a.id} style={styles.segRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.segRoom}>{roomLabel(a.room)}</Text>
                  <Text style={styles.segDates}>{formatDate(a.start)} – {formatDate(a.end)}</Text>
                </View>
                <TouchableOpacity onPress={() => openEdit(a)} disabled={busy} activeOpacity={0.7}>
                  <Text style={styles.segAction}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onRemove(a.id!)} disabled={busy} activeOpacity={0.7}>
                  <Text style={[styles.segAction, styles.segRemove]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}

            {editingId ? (
              <View style={styles.segForm}>
                <Text style={styles.printFieldLabel}>Room</Text>
                <ScrollView style={{ maxHeight: 150 }}>
                  {ROOMS.map(r => {
                    const active = fRoom === r.key;
                    const owner = 'owner' in r ? r.owner : null;
                    return (
                      <TouchableOpacity
                        key={r.key}
                        style={[styles.roomSheetRow, active && styles.roomSheetRowActive]}
                        onPress={() => setFRoom(r.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.roomSheetRowText, active && styles.roomSheetRowTextActive]}>
                          {r.label}{owner ? `  ·  ${owner}'s` : ''}
                        </Text>
                        {active && <Text style={styles.roomSheetCheck}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <View style={styles.printRow}>
                  <PrintDateField label="From" value={fStart} min={stayStart} max={fEnd || stayEnd} onChange={setFStart} />
                  <PrintDateField label="To" value={fEnd} min={fStart || stayStart} max={stayEnd} onChange={setFEnd} />
                </View>
                {error && <Text style={styles.datesWarn}>{error}</Text>}
                <View style={styles.segFormBtns}>
                  <TouchableOpacity style={styles.segCancelBtn} onPress={() => setEditingId(null)} activeOpacity={0.7}>
                    <Text style={styles.segCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.printGoBtn, { flex: 1, marginTop: 0 }, !canSave && { opacity: 0.5 }]} onPress={save} disabled={!canSave} activeOpacity={0.85}>
                    <Text style={styles.printGoBtnText}>{editingId === 'new' ? 'Add room' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.segAddBtn} onPress={openAdd} disabled={busy} activeOpacity={0.8}>
                <Text style={styles.segAddText}>＋ Add room segment</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          {busy && <ActivityIndicator color="#C85A2E" style={{ marginTop: 8 }} />}
          <Text style={styles.modalDismissHint}>Tap outside to close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// A small web-only date field: a labelled box with a transparent native
// <input type="date"> overlaid so tapping opens the browser's date picker.
function PrintDateField({ label, value, min, max, onChange }: {
  label: string; value: string; min?: string; max?: string; onChange: (v: string) => void;
}) {
  return (
    <View style={styles.printField}>
      <Text style={styles.printFieldLabel}>{label}</Text>
      <View style={styles.printFieldBox}>
        <Text style={styles.printFieldValue}>{value ? formatDate(value) : '—'}</Text>
        {Platform.OS === 'web' && (
          <input
            type="date"
            value={value}
            min={min}
            max={max}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.value) onChange(e.target.value); }}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none', padding: 0, margin: 0 } as React.CSSProperties}
          />
        )}
      </View>
    </View>
  );
}

// Shared date-range print dialog (meals + apéritifs). No room-style toggle.
function DateRangePrintModal({ visible, title, intro, from, to, onChangeFrom, onChangeTo, onPrint, onClose }: {
  visible: boolean;
  title: string;
  intro: string;
  from: string;
  to: string;
  onChangeFrom: (v: string) => void;
  onChangeTo: (v: string) => void;
  onPrint: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  const valid = !!from && !!to;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomSheet}>
          <Text style={styles.roomSheetTitle}>{title}</Text>
          <Text style={styles.printIntro}>{intro}</Text>
          <View style={styles.printRow}>
            <PrintDateField label="From" value={from} onChange={onChangeFrom} />
            <PrintDateField label="To" value={to} min={from} onChange={onChangeTo} />
          </View>
          <TouchableOpacity
            style={[styles.printGoBtn, !valid && { opacity: 0.5 }]}
            onPress={() => valid && onPrint()}
            disabled={!valid}
            activeOpacity={0.85}
          >
            <Text style={styles.printGoBtnText}>🖨  Print</Text>
          </TouchableOpacity>
          <Text style={styles.modalDismissHint}>Tap outside to close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function RoomPrintModal({ visible, from, to, hideEmpty, onChangeFrom, onChangeTo, onToggleHideEmpty, onPrint, onClose }: {
  visible: boolean;
  from: string;
  to: string;
  hideEmpty: boolean;
  onChangeFrom: (v: string) => void;
  onChangeTo: (v: string) => void;
  onToggleHideEmpty: () => void;
  onPrint: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomSheet}>
          <Text style={styles.roomSheetTitle}>Print room schedule</Text>
          <Text style={styles.printIntro}>Defaults to the whole summer — the first arrival to the last departure.</Text>

          <View style={styles.printRow}>
            <PrintDateField label="From" value={from} onChange={onChangeFrom} />
            <PrintDateField label="To" value={to} min={from} onChange={onChangeTo} />
          </View>

          <TouchableOpacity style={styles.printCheckRow} onPress={onToggleHideEmpty} activeOpacity={0.7}>
            <View style={[styles.printCheckbox, hideEmpty && styles.printCheckboxOn]}>
              {hideEmpty && <Text style={styles.printCheckboxTick}>✓</Text>}
            </View>
            <Text style={styles.printCheckLabel}>Hide rooms with no one staying</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.printGoBtn} onPress={onPrint} activeOpacity={0.85}>
            <Text style={styles.printGoBtnText}>🖨  Print</Text>
          </TouchableOpacity>
          <Text style={styles.modalDismissHint}>Tap outside to close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Admin editor for a member's arrival / departure dates (manage mode).
function VisitDatesModal({ member, busy, onSave, onClose }: {
  member: FamilyMember | null;
  busy: boolean;
  onSave: (arriveDate: string, departDate: string) => void;
  onClose: () => void;
}) {
  const [arrive, setArrive] = useState('');
  const [depart, setDepart] = useState('');
  useEffect(() => {
    setArrive(member?.arriveDate ? String(member.arriveDate).slice(0, 10) : '');
    setDepart(member?.departDate ? String(member.departDate).slice(0, 10) : '');
  }, [member]);
  if (!member) return null;
  const valid = !!arrive && !!depart && depart >= arrive;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.roomSheet}>
          <Text style={styles.roomSheetTitle}>Dates for {member.name.split(' ')[0]}</Text>
          <Text style={styles.printIntro}>Fix a member's arrival and departure dates if they entered them wrong.</Text>

          <View style={styles.printRow}>
            <PrintDateField label="Arrival" value={arrive} onChange={setArrive} />
            <PrintDateField label="Departure" value={depart} min={arrive} onChange={setDepart} />
          </View>

          {arrive && depart && !valid && (
            <Text style={styles.datesWarn}>Departure must be on or after arrival.</Text>
          )}

          <TouchableOpacity
            style={[styles.printGoBtn, (!valid || busy) && { opacity: 0.5 }]}
            onPress={() => valid && !busy && onSave(arrive, depart)}
            disabled={!valid || busy}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color="#F5EDD6" size="small" />
              : <Text style={styles.printGoBtnText}>Save dates</Text>}
          </TouchableOpacity>
          <Text style={styles.modalDismissHint}>Tap outside to close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function FamilyScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('people');
  // Show the Events spinner only on first load — never on a background poll,
  // which would collapse the list height and reset Android scroll to the top.
  const eventsLoadedRef = useRef(false);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [changingRoleIds, setChangingRoleIds] = useState<Set<string>>(new Set());
  const [managing, setManaging] = useState(false);
  const [events, setEvents] = useState<ChateauEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [addingToDate, setAddingToDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [segmentMemberId, setSegmentMemberId] = useState<string | null>(null); // segment-editor target (People tab)
  const [roomBusyId, setRoomBusyId] = useState<string | null>(null);
  const [datesForMember, setDatesForMember] = useState<FamilyMember | null>(null); // date-edit target (manage mode)
  const [datesBusyId, setDatesBusyId] = useState<string | null>(null);
  // Rooms print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [printFrom, setPrintFrom] = useState('');
  const [printTo, setPrintTo] = useState('');
  const [printHideEmpty, setPrintHideEmpty] = useState(false);
  // Rooms timeline
  const [screenW, setScreenW] = useState(Dimensions.get('window').width);
  const roomsBodyScrollRef = useRef<ScrollView>(null);
  const roomsHeadScrollRef = useRef<ScrollView>(null);
  // True once we've centred the timeline for the current tab activation, so
  // background refreshes (which rebuild roomTimeline) don't reset scroll.
  const roomsCenteredRef = useRef(false);
  const [ownerBusyId, setOwnerBusyId] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [testDataMessage, setTestDataMessage] = useState<string | null>(null);

  async function seedTestUsers() {
    if (!user) return;
    setIsSeeding(true);
    setTestDataMessage(null);
    try {
      const res = await fetch('/api/admin/test-users', { method: 'POST', headers: { 'x-admin-id': user.id } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setTestDataMessage(`Created ${body.created} test users ✓`);
        await fetchAll(true);
      } else {
        setTestDataMessage(body.error ?? `Error ${res.status}`);
      }
    } catch (e: any) {
      setTestDataMessage(e?.message ?? 'Network error');
    } finally {
      setIsSeeding(false);
    }
  }

  async function clearTestUsers() {
    if (!user) return;
    setIsClearing(true);
    setTestDataMessage(null);
    try {
      const res = await fetch('/api/admin/test-users', { method: 'DELETE', headers: { 'x-admin-id': user.id } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setTestDataMessage(`Removed ${body.deleted ?? '?'} test users ✓`);
        await fetchAll(true);
      } else {
        setTestDataMessage(body.error ?? `Error ${res.status}`);
      }
    } catch (e: any) {
      setTestDataMessage(e?.message ?? 'Network error');
    } finally {
      setIsClearing(false);
    }
  }

  async function runMigrate() {
    if (!user) return;
    setIsMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch('/api/migrate', { method: 'POST', headers: { 'x-admin-id': user.id } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMigrateResult({ ok: true, message: body.message ?? 'Migrations applied ✓' });
      } else {
        setMigrateResult({ ok: false, message: body.error ?? `Error ${res.status}` });
      }
    } catch (e: any) {
      setMigrateResult({ ok: false, message: e?.message ?? 'Network error' });
    } finally {
      setIsMigrating(false);
    }
  }

  const fetchAll = useCallback(async (showRefresh = false) => {
    if (!user) return;
    if (showRefresh) setIsRefreshing(true);
    setFetchError(null);
    try {
      const requests: Promise<Response>[] = [
        fetch('/api/family/members', { headers: { 'x-user-id': user.id } }),
      ];
      if (user.isAdmin) {
        requests.push(fetch('/api/admin/users', { headers: { 'x-admin-id': user.id } }));
      }
      const [membersRes, pendingRes] = await Promise.all(requests);
      let membersData: FamilyMember[] = [];
      if (membersRes.ok) {
        const data = await membersRes.json();
        membersData = Array.isArray(data) ? data : [];
        setMembers(membersData);
      } else {
        setFetchError(`Could not load family members (${membersRes.status})`);
      }
      if (pendingRes?.ok) {
        const data = await pendingRes.json();
        setPending(Array.isArray(data) ? data : []);
      }
      // Fetch events — admins see a wider window, non-admins see their stay only
      const myMember = membersData.find(m => m.id === user.id);
      const isAdmin = user.isAdmin;
      const anchor = myMember?.arriveDate ? String(myMember.arriveDate).slice(0, 10) : todayStr();
      const fetchFrom = isAdmin ? addDays(anchor, -ADMIN_DAYS_BEFORE) : (myMember?.arriveDate ? String(myMember.arriveDate).slice(0, 10) : null);
      const fetchTo   = isAdmin ? addDays(anchor, ADMIN_DAYS_AFTER) : (myMember?.departDate ? String(myMember.departDate).slice(0, 10) : null);
      if (fetchFrom && fetchTo) {
        if (!eventsLoadedRef.current) setEventsLoading(true);
        try {
          const evRes = await fetch(
            `/api/events?from=${fetchFrom}&to=${fetchTo}`,
            { headers: { 'x-user-id': user.id } }
          );
          if (evRes.ok) {
            const evData = await evRes.json();
            setEvents(Array.isArray(evData) ? evData : []);
          }
        } finally {
          setEventsLoading(false);
          eventsLoadedRef.current = true;
        }
      } else {
        setEvents([]);
        eventsLoadedRef.current = true;
      }
    } catch (e: any) {
      setFetchError(e.message ?? 'Network error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useAutoRefresh(fetchAll, FAMILY_REFRESH_MS);

  async function reject(userId: string) {
    if (!user) return;
    setRejectingIds(prev => new Set(prev).add(userId));
    try {
      const res = await fetch(`/api/admin/remove/${userId}`, {
        method: 'DELETE',
        headers: { 'x-admin-id': user.id },
      });
      if (res.ok) setPending(prev => prev.filter(u => u.id !== userId));
    } finally {
      setRejectingIds(prev => { const n = new Set(prev); n.delete(userId); return n; });
    }
  }

  async function approve(userId: string) {
    if (!user) return;
    setApprovingIds(prev => new Set(prev).add(userId));
    try {
      await fetch(`/api/admin/approve/${userId}`, {
        method: 'POST',
        headers: { 'x-admin-id': user.id },
      });
      setPending(prev => prev.filter(u => u.id !== userId));
      const res = await fetch('/api/family/members', { headers: { 'x-user-id': user.id } });
      if (res.ok) { const d = await res.json(); setMembers(Array.isArray(d) ? d : []); }
    } finally {
      setApprovingIds(prev => { const n = new Set(prev); n.delete(userId); return n; });
    }
  }

  function confirmRemove(member: FamilyMember) {
    const doRemove = () => remove(member.id);
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${member.name} from the platform? This cannot be undone.`)) doRemove();
    } else {
      Alert.alert(
        'Remove member',
        `Remove ${member.name} from the platform? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ]
      );
    }
  }

  async function remove(memberId: string) {
    if (!user) return;
    setRemovingIds(prev => new Set(prev).add(memberId));
    try {
      const res = await fetch(`/api/admin/remove/${memberId}`, {
        method: 'DELETE',
        headers: { 'x-admin-id': user.id },
      });
      if (res.ok) setMembers(prev => prev.filter(m => m.id !== memberId));
    } finally {
      setRemovingIds(prev => { const n = new Set(prev); n.delete(memberId); return n; });
    }
  }

  async function changeRole(memberId: string, role: Role) {
    if (!user) return;
    setChangingRoleIds(prev => new Set(prev).add(memberId));
    try {
      const res = await fetch(`/api/admin/role/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': user.id },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setMembers(prev => prev.map(m =>
          m.id === memberId ? { ...m, role, isAdmin: role === 'admin' } : m
        ));
      }
    } finally {
      setChangingRoleIds(prev => { const n = new Set(prev); n.delete(memberId); return n; });
    }
  }

  // Date-ranged room allocation mutators (admin, manage mode). Each refreshes from
  // the server on success so the timeline and editor reflect the new segments.
  const allocErr = (msg: string) => {
    if (Platform.OS === 'web') window.alert(msg); else Alert.alert('Rooms', msg);
  };

  async function addAllocation(userId: string, seg: { room: string; start: string; end: string }) {
    if (!user) return;
    setRoomBusyId(userId);
    try {
      const res = await fetch('/api/admin/room-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': user.id },
        body: JSON.stringify({ userId, ...seg }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) await fetchAll(); else allocErr(body.error ?? 'Could not add room');
    } finally { setRoomBusyId(null); }
  }

  async function updateAllocation(userId: string, id: string, patch: { room?: string; start?: string; end?: string }) {
    if (!user) return;
    setRoomBusyId(userId);
    try {
      const res = await fetch(`/api/admin/room-allocations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': user.id },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) await fetchAll(); else allocErr(body.error ?? 'Could not update room');
    } finally { setRoomBusyId(null); }
  }

  async function removeAllocation(userId: string, id: string) {
    if (!user) return;
    setRoomBusyId(userId);
    try {
      const res = await fetch(`/api/admin/room-allocations/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-id': user.id },
      });
      if (res.ok) await fetchAll();
    } finally { setRoomBusyId(null); }
  }

  // Admin fix-up of a member's arrival/departure dates (manage mode).
  async function changeVisitDates(memberId: string, arriveDate: string, departDate: string) {
    if (!user) return;
    setDatesBusyId(memberId);
    try {
      const res = await fetch(`/api/admin/visit/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': user.id },
        body: JSON.stringify({ arriveDate, departDate }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === memberId ? {
          ...m,
          arriveDate: body.arriveDate ?? arriveDate,
          departDate: body.departDate ?? departDate,
          arriveSlot: body.arriveSlot ?? m.arriveSlot,
          departSlot: body.departSlot ?? m.departSlot,
          visitStatus: (body.status ?? 'coming') as FamilyMember['visitStatus'],
        } : m));
        setDatesForMember(null);
      } else {
        const msg = body.error ?? 'Could not update dates';
        if (Platform.OS === 'web') window.alert(msg); else Alert.alert('Dates', msg);
      }
    } finally {
      setDatesBusyId(null);
    }
  }

  async function changeOwner(memberId: string, makeOwner: boolean) {
    if (!user) return;
    setOwnerBusyId(memberId);
    try {
      const res = await fetch(`/api/admin/owner/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ owner: makeOwner }),
      });
      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === memberId
          ? { ...m, isOwner: makeOwner, ...(makeOwner ? { role: 'admin' as Role, isAdmin: true } : {}) }
          : m));
      } else {
        const body = await res.json().catch(() => ({}));
        if (Platform.OS === 'web') window.alert(body.error ?? 'Could not change owner');
        else Alert.alert('Owner', body.error ?? 'Could not change owner');
      }
    } finally {
      setOwnerBusyId(null);
    }
  }

  async function addEvent(date: string) {
    if (!user || !newTitle.trim()) return;
    setSavingEvent(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': user.id },
        body: JSON.stringify({ date, title: newTitle.trim(), time: newTime.trim() || null }),
      });
      if (res.ok) {
        const ev: ChateauEvent = await res.json();
        setEvents(prev =>
          [...prev, ev].sort((a, b) =>
            a.eventDate.localeCompare(b.eventDate) ||
            (a.eventTime ?? '').localeCompare(b.eventTime ?? '') ||
            a.createdAt.localeCompare(b.createdAt)
          )
        );
        setAddingToDate(null);
        setNewTitle('');
        setNewTime('');
      }
    } finally {
      setSavingEvent(false);
    }
  }

  async function deleteEvent(eventId: string) {
    if (!user) return;
    setDeletingEventId(eventId);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'DELETE',
        headers: { 'x-admin-id': user.id },
      });
      if (res.ok) setEvents(prev => prev.filter(e => e.id !== eventId));
    } finally {
      setDeletingEventId(null);
    }
  }

  const currentMember = members.find(m => m.id === user?.id);
  const canSeeSummary = !!currentMember;

  const renderPeopleTab = () => (
    <ScrollView
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={() => fetchAll(true)} tintColor="#C85A2E" />
      }
    >
      {canSeeSummary && <TonightSummaryCard members={members} />}
      {canSeeSummary && user && <BellCard userId={user.id} />}

      {user?.isAdmin && pending.length > 0 && (
        <>
          <View style={styles.sectionDivider}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerLabel}>Waiting for access 🚪</Text>
            <View style={styles.sectionDividerLine} />
          </View>

          {pending.map(person => (
            <View key={person.id} style={styles.card}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(person.name) }]}>
                <Text style={styles.avatarText}>{initials(person.name)}</Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{person.name}</Text>
                <Text style={styles.visitNone}>Joined {timeAgo(person.createdAt)}</Text>
              </View>
              <TouchableOpacity
                style={[styles.rejectBtn, rejectingIds.has(person.id) && styles.rejectBtnBusy]}
                onPress={() => reject(person.id)}
                disabled={rejectingIds.has(person.id) || approvingIds.has(person.id)}
                activeOpacity={0.8}
              >
                {rejectingIds.has(person.id)
                  ? <ActivityIndicator color="#C85A2E" size="small" />
                  : <Text style={styles.rejectBtnText}>Reject</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.approveBtn, approvingIds.has(person.id) && styles.approveBtnBusy]}
                onPress={() => approve(person.id)}
                disabled={approvingIds.has(person.id) || rejectingIds.has(person.id)}
                activeOpacity={0.8}
              >
                {approvingIds.has(person.id)
                  ? <ActivityIndicator color="#F5EDD6" size="small" />
                  : <Text style={styles.approveBtnText}>Approve ✓</Text>
                }
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {members.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🌿</Text>
          <Text style={styles.emptyTitle}>Just you so far</Text>
          <Text style={styles.emptyBody}>Share the link with family to get them on board.</Text>
        </View>
      ) : (() => {
        const today = todayStr();
        const hereNow      = members.filter(m => m.arriveDate && m.departDate && today >= m.arriveDate && today <= m.departDate);
        const arrivingSoon = members.filter(m => m.arriveDate && today < m.arriveDate).sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
        const alreadyLeft  = members.filter(m => m.departDate && today > m.departDate).sort((a, b) => b.departDate!.localeCompare(a.departDate!));
        const noPlans      = members.filter(m => !m.arriveDate).sort((a, b) => a.name.localeCompare(b.name));

        const renderCard = (m: FamilyMember) => (
          <MemberCard
            key={m.id}
            member={m}
            managing={managing}
            onRemove={(managing && user?.isAdmin && !m.isAdmin) ? () => confirmRemove(m) : undefined}
            removing={removingIds.has(m.id)}
            onRoleChange={(managing && user?.isAdmin && m.id !== user.id) ? (role) => changeRole(m.id, role) : undefined}
            changingRole={changingRoleIds.has(m.id)}
            canGrantAdmin={!!user?.isOwner}
            onOwnerToggle={(managing && user?.isOwner && m.id !== user.id) ? (makeOwner) => changeOwner(m.id, makeOwner) : undefined}
            changingOwner={ownerBusyId === m.id}
            onRoomPress={(managing && user?.isAdmin) ? () => setSegmentMemberId(m.id) : undefined}
            roomBusy={roomBusyId === m.id}
            onDatesPress={(managing && user?.isAdmin) ? () => setDatesForMember(m) : undefined}
            datesBusy={datesBusyId === m.id}
            onPress={() => setSelectedMember(m)}
          />
        );

        const renderSection = (label: string, group: FamilyMember[]) => group.length === 0 ? null : (
          <>
            <View style={styles.sectionDivider}>
              <View style={styles.sectionDividerLine} />
              <Text style={styles.sectionDividerLabel}>{label}</Text>
              <View style={styles.sectionDividerLine} />
            </View>
            {group.map(renderCard)}
          </>
        );

        return (
          <>
            {renderSection('Here now 🏠', hereNow)}
            {renderSection('Arriving soon', arrivingSoon)}
            {renderSection('Already left', alreadyLeft)}
            {renderSection('No plans yet', noPlans)}
          </>
        );
      })()}

      {user?.isAdmin && pending.length === 0 && members.length > 0 && (
        <Text style={styles.allClear}>All caught up — no one waiting 🌿</Text>
      )}

      {user?.isOwner && (() => {
        const testCount = members.filter(m => m.isTest).length;
        return (
          <View style={styles.testDataCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.testDataLabel}>Test users{testCount > 0 ? ` (${testCount} active)` : ''}</Text>
              {testDataMessage && <Text style={styles.testDataMessage}>{testDataMessage}</Text>}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.testDataBtn, (isSeeding || isClearing) && styles.testDataBtnBusy]}
                onPress={seedTestUsers}
                disabled={isSeeding || isClearing}
                activeOpacity={0.8}
              >
                {isSeeding
                  ? <ActivityIndicator color="#5C3D2E" size="small" />
                  : <Text style={styles.testDataBtnText}>Seed</Text>
                }
              </TouchableOpacity>
              {testCount > 0 && (
                <TouchableOpacity
                  style={[styles.testDataBtn, styles.testDataClearBtn, (isSeeding || isClearing) && styles.testDataBtnBusy]}
                  onPress={clearTestUsers}
                  disabled={isSeeding || isClearing}
                  activeOpacity={0.8}
                >
                  {isClearing
                    ? <ActivityIndicator color="#C85A2E" size="small" />
                    : <Text style={[styles.testDataBtnText, { color: '#C85A2E' }]}>Clear</Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })()}

      {user?.isOwner && (
        <View style={styles.migrateCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.migrateLabel}>Database migrations</Text>
            {migrateResult && (
              <Text style={[styles.migrateResult, migrateResult.ok ? styles.migrateResultOk : styles.migrateResultErr]}>
                {migrateResult.message}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.migrateBtn, isMigrating && styles.migrateBtnBusy]}
            onPress={runMigrate}
            disabled={isMigrating}
            activeOpacity={0.8}
          >
            {isMigrating
              ? <ActivityIndicator color="#5C3D2E" size="small" />
              : <Text style={styles.migrateBtnText}>Run</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );

  const renderEventsTab = () => {
    const today = todayStr();
    return (
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => fetchAll(true)} tintColor="#C85A2E" />
        }
      >
        {eventsLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color="#C85A2E" />
          </View>
        ) : (!currentMember?.arriveDate && !user?.isAdmin) ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={styles.emptyTitle}>No visit planned</Text>
            <Text style={styles.emptyBody}>Set your visit dates on the My Visit tab to see Château events.</Text>
          </View>
        ) : (() => {
          const anchor = currentMember?.arriveDate
            ? String(currentMember.arriveDate).slice(0, 10)
            : todayStr();
          const rangeFrom = user?.isAdmin ? addDays(anchor, -ADMIN_DAYS_BEFORE) : anchor;
          const rangeTo   = user?.isAdmin
            ? addDays(anchor, ADMIN_DAYS_AFTER)
            : String(currentMember!.departDate!).slice(0, 10);
          return datesBetween(rangeFrom, rangeTo).map(date => {
            const isToday = date === today;
            const isPast  = date < today;
            const dayEvents = events.filter(e => e.eventDate === date);
            const arrivals   = members.filter(m => m.arriveDate && String(m.arriveDate).slice(0, 10) === date);
            const departures = members.filter(m => m.departDate && String(m.departDate).slice(0, 10) === date);
            const isAddingHere = addingToDate === date;

            return (
              <View key={date} style={[styles.eventDateSection, isPast && styles.eventDateSectionPast]}>
                <View style={styles.eventDateHeader}>
                  <Text style={[
                    styles.eventDateLabel,
                    isToday && styles.eventDateLabelToday,
                    isPast && styles.eventDateLabelPast,
                  ]}>
                    {isToday ? '🏠 ' : ''}{formatDateLong(date)}
                  </Text>
                  {user?.isAdmin && !isPast && !isAddingHere && (
                    <TouchableOpacity
                      style={styles.eventAddBtn}
                      onPress={() => { setAddingToDate(date); setNewTitle(''); setNewTime(''); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.eventAddBtnText}>+ Add</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {arrivals.map(m => (
                  <View key={`arrive-${m.id}`} style={[styles.eventRow, styles.eventRowMovement, isPast && { opacity: 0.55 }]}>
                    <Text style={styles.eventMovementIcon}>🚗</Text>
                    <Text style={styles.eventMovementText}>
                      {m.name} arrives{m.arriveSlot ? ` — ${slotLabel(m.arriveSlot)}` : ''}
                    </Text>
                  </View>
                ))}

                {departures.map(m => (
                  <View key={`depart-${m.id}`} style={[styles.eventRow, styles.eventRowMovement, isPast && { opacity: 0.55 }]}>
                    <Text style={styles.eventMovementIcon}>👋</Text>
                    <Text style={styles.eventMovementText}>
                      {m.name} leaves{m.departSlot ? ` — ${slotLabel(m.departSlot)}` : ''}
                    </Text>
                  </View>
                ))}

                {dayEvents.map(ev => (
                  <View key={ev.id} style={[styles.eventRow, isPast && { opacity: 0.55 }]}>
                    {ev.eventTime ? (
                      <View style={styles.eventTimeBadge}>
                        <Text style={styles.eventTimeText}>{ev.eventTime}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.eventTitle}>{ev.title}</Text>
                    {user?.isAdmin && (
                      <TouchableOpacity
                        onPress={() => deleteEvent(ev.id)}
                        disabled={deletingEventId === ev.id}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {deletingEventId === ev.id
                          ? <ActivityIndicator size="small" color="#C85A2E" />
                          : <Text style={styles.eventDeleteBtn}>✕</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                {dayEvents.length === 0 && arrivals.length === 0 && departures.length === 0 && !isAddingHere && (
                  <Text style={[styles.eventNone, isPast && { opacity: 0.45 }]}>Nothing planned</Text>
                )}

                {isAddingHere && (
                  <View style={styles.eventAddForm}>
                    <TextInput
                      style={styles.eventAddInput}
                      placeholder="What's happening?"
                      placeholderTextColor="#B8956A"
                      value={newTitle}
                      onChangeText={setNewTitle}
                      autoFocus
                      returnKeyType="next"
                    />
                    <TextInput
                      style={styles.eventAddInput}
                      placeholder="Time (optional, e.g. 18:30)"
                      placeholderTextColor="#B8956A"
                      value={newTime}
                      onChangeText={setNewTime}
                      returnKeyType="done"
                      onSubmitEditing={() => addEvent(date)}
                    />
                    <View style={styles.eventAddActions}>
                      <TouchableOpacity
                        onPress={() => setAddingToDate(null)}
                        style={styles.eventCancelBtn}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.eventCancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => addEvent(date)}
                        style={[styles.eventSaveBtn, (!newTitle.trim() || savingEvent) && { opacity: 0.4 }]}
                        disabled={!newTitle.trim() || savingEvent}
                        activeOpacity={0.8}
                      >
                        {savingEvent
                          ? <ActivityIndicator size="small" color="#F5EDD6" />
                          : <Text style={styles.eventSaveBtnText}>Add</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          });
        })()}
      </ScrollView>
    );
  };

  // ── Rooms timeline ──
  const ROOM_COL_W = 96;
  const WHO_COL_W = 38;
  const LEFT_W = ROOM_COL_W + WHO_COL_W;   // 134 total — unchanged
  const ROW_H = 52;
  const dayWidth = Math.max(30, Math.floor((screenW - LEFT_W) / 7));

  // Keep dayWidth responsive to rotation / resize.
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreenW(window.width));
    return () => { (sub as any)?.remove?.(); };
  }, []);

  const roomTimeline = useMemo(() => {
    // Expand every member's effective allocations into placed segments per room.
    const byRoom: Record<string, RoomSeg[]> = {};
    members.forEach(m => {
      allocationsForMember(m.allocations, m).forEach(s => {
        (byRoom[s.room] ||= []).push({ memberId: m.id, name: m.name, avatar: m.avatar, start: s.start, end: s.end });
      });
    });
    const today = todayStr();
    const starts: string[] = [], ends: string[] = [];
    Object.values(byRoom).forEach(arr => arr.forEach(s => { starts.push(s.start); ends.push(s.end); }));
    const minA = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : today;
    const maxD = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : today;
    const spanStart = startOfWeek(minA < today ? minA : today);
    const spanEnd = endOfWeek(maxD > today ? maxD : today);
    // Gantt-style ordering: rooms whose first segment starts earliest come first;
    // unused rooms sink to the bottom in master-list order.
    const firstStart: Record<string, string> = {};
    Object.entries(byRoom).forEach(([k, ms]) => {
      firstStart[k] = ms.map(s => s.start).reduce((a, b) => (a < b ? a : b));
    });
    const idx = Object.fromEntries(ROOMS.map((r, i) => [r.key, i]));
    const orderedRooms = [...ROOMS].sort((a, b) => {
      const fa = firstStart[a.key], fb = firstStart[b.key];
      if (fa && fb) return fa !== fb ? (fa < fb ? -1 : 1) : idx[a.key] - idx[b.key];
      if (fa) return -1;
      if (fb) return 1;
      return idx[a.key] - idx[b.key];
    });
    return { byRoom, days: datesBetween(spanStart, spanEnd), today, orderedRooms };
  }, [members]);

  // Distinct members occupying a room at any point (for the left "Who" chips), in
  // order of first arrival into the room.
  const whoIn = (roomKey: string) => {
    const segs = [...(roomTimeline.byRoom[roomKey] ?? [])].sort((a, b) => (a.start < b.start ? -1 : 1));
    const seen = new Set<string>();
    const out: { id: string; name: string; avatar?: string | null }[] = [];
    segs.forEach(s => { if (!seen.has(s.memberId)) { seen.add(s.memberId); out.push({ id: s.memberId, name: s.name, avatar: s.avatar }); } });
    return out;
  };

  // Greedy lane packing so overlapping (shared) segments stack within the row.
  const layoutLanes = (segs: RoomSeg[]) => {
    const sorted = [...segs].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const laneEnds: string[] = [];
    const placed: (RoomSeg & { lane: number })[] = [];
    sorted.forEach(s => {
      // Night-use model: bars run mid-day → mid-day, so a segment ending on day D and
      // another starting on day D only touch at the midpoint → they may share a lane.
      let lane = laneEnds.findIndex(end => end <= s.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.end); } else { laneEnds[lane] = s.end; }
      placed.push({ ...s, lane });
    });
    return { placed, laneCount: Math.max(1, laneEnds.length) };
  };

  // Days on which a room's bed turns over (a segment starts while a DIFFERENT
  // person's segment ends the day before or the same day) → staff remake beds.
  const changeoverDays = (segs: RoomSeg[]) => {
    const marks = new Set<string>();
    segs.forEach(s => {
      const prev = addDays(s.start, -1);
      if (segs.some(o => o.memberId !== s.memberId && (o.end === prev || o.end === s.start))) marks.add(s.start);
    });
    return marks;
  };

  // Default print range = first arrival → last departure across everyone with dates
  // (the whole summer). Falls back to today when nobody has planned a visit yet.
  const summerSpan = useMemo(() => {
    const withDates = members.filter(m => m.arriveDate && m.departDate);
    if (!withDates.length) { const t = todayStr(); return { from: t, to: t }; }
    const arrs = withDates.map(m => String(m.arriveDate).slice(0, 10));
    const deps = withDates.map(m => String(m.departDate).slice(0, 10));
    return { from: arrs.reduce((a, b) => (a < b ? a : b)), to: deps.reduce((a, b) => (a > b ? a : b)) };
  }, [members]);

  const openPrintDialog = () => {
    setPrintFrom(summerSpan.from);
    setPrintTo(summerSpan.to);
    setPrintOpen(true);
  };

  // Re-arm the "open on current week" centring whenever the tab is (re)entered
  // or the layout width changes (rotation/resize) — but NOT on a background data
  // refresh, so a poll can't yank the timeline back to the far left mid-scroll.
  useEffect(() => { roomsCenteredRef.current = false; }, [activeTab, dayWidth]);

  // Open the Rooms timeline on the current week — once per activation, after data
  // is present. The roomTimeline dep lets this fire when the first load arrives;
  // the ref guard stops it re-firing on subsequent (background) rebuilds.
  useEffect(() => {
    if (activeTab !== 'rooms' || roomsCenteredRef.current) return;
    const { days, today } = roomTimeline;
    if (days.length === 0) return;
    roomsCenteredRef.current = true;
    const ti = days.indexOf(today);
    const x = (ti >= 0 ? Math.floor(ti / 7) * 7 : 0) * dayWidth;
    const id = setTimeout(() => {
      roomsBodyScrollRef.current?.scrollTo({ x, animated: false });
      roomsHeadScrollRef.current?.scrollTo({ x, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [activeTab, roomTimeline, dayWidth]);

  const renderRoomsTab = () => {
    const { days, today, orderedRooms } = roomTimeline;
    const contentW = days.length * dayWidth;
    const dObj = (d: string) => new Date(d + 'T12:00:00');
    const wdInitial = (d: string) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dObj(d).getDay()];
    const isWeekend = (d: string) => { const g = dObj(d).getDay(); return g === 0 || g === 6; };

    return (
      <View style={styles.tlContainer}>
        {/* Header: corner + scrollable dates */}
        <View style={styles.tlHeaderRow}>
          <View style={[styles.tlCorner, { width: LEFT_W }]}>
            <Text style={styles.tlCornerText}>ROOM</Text>
            <Text style={styles.tlCornerText}>WHO</Text>
          </View>
          <ScrollView
            horizontal
            ref={roomsHeadScrollRef}
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={{ width: screenW - LEFT_W }}
          >
            <View style={{ flexDirection: 'row', width: contentW }}>
              {days.map(d => (
                <View key={d} style={[styles.tlHeadCell, { width: dayWidth }, isWeekend(d) && styles.tlWeekend, d === today && styles.tlTodayCol]}>
                  <Text style={[styles.tlHeadWd, d === today && styles.tlTodayText]}>{wdInitial(d)}</Text>
                  <Text style={[styles.tlHeadDay, d === today && styles.tlTodayText]}>{dObj(d).getDate()}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Body: fixed left columns + horizontally-scrollable bars */}
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => fetchAll(true)} tintColor="#C85A2E" />}
        >
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: LEFT_W }}>
              {orderedRooms.map(room => {
                const who = whoIn(room.key);
                const owner = 'owner' in room ? room.owner : null;
                return (
                  <View key={room.key} style={[styles.tlLeftRow, { height: ROW_H, width: LEFT_W }]}>
                    <View style={{ width: ROOM_COL_W - 8, paddingRight: 4 }}>
                      <Text style={styles.tlRoomName} numberOfLines={1}>{room.label}</Text>
                      {owner && <Text style={styles.tlRoomOwner} numberOfLines={1}>{owner}'s</Text>}
                    </View>
                    <View style={styles.tlWho}>
                      {who.slice(0, 3).map(w => (
                        <TouchableOpacity key={w.id} onPress={() => { const mm = members.find(x => x.id === w.id); if (mm) setSelectedMember(mm); }} activeOpacity={0.7}>
                          {w.avatar
                            ? <Image source={{ uri: w.avatar }} style={styles.tlChip} />
                            : <View style={[styles.tlChip, styles.tlChipFallback, { backgroundColor: avatarColor(w.name) }]}>
                                <Text style={styles.tlChipText}>{initials(w.name)}</Text>
                              </View>}
                        </TouchableOpacity>
                      ))}
                      {who.length > 3 && <Text style={styles.tlWhoMore}>+{who.length - 3}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>

            <ScrollView
              horizontal
              ref={roomsBodyScrollRef}
              onScroll={e => roomsHeadScrollRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })}
              scrollEventThrottle={16}
              snapToInterval={dayWidth * 7}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              style={{ width: screenW - LEFT_W }}
            >
              <View style={{ width: contentW }}>
                {orderedRooms.map(room => {
                  const segs = roomTimeline.byRoom[room.key] ?? [];
                  const { placed, laneCount } = layoutLanes(segs);
                  const marks = changeoverDays(segs);
                  const laneH = ROW_H / laneCount;
                  return (
                    <View key={room.key} style={[styles.tlBarRow, { height: ROW_H, width: contentW }]}>
                      {/* day-grid background (weekend / today tint) */}
                      {days.map(d => (
                        <View key={d} style={[styles.tlCell, { width: dayWidth }, isWeekend(d) && styles.tlWeekend, d === today && styles.tlTodayCol]} />
                      ))}
                      {/* one coloured bar per person-stay, stacked into lanes */}
                      {placed.map(s => {
                        const si = days.indexOf(s.start), ei = days.indexOf(s.end);
                        const startIdx = si < 0 ? 0 : si;
                        const endIdx = ei < 0 ? days.length - 1 : ei;
                        // Night use: bar runs from the middle of the arrival day to the
                        // middle of the departure day, so handoffs meet at the midpoint.
                        const rawW = (endIdx - startIdx) * dayWidth;
                        const width = rawW > 0 ? rawW : dayWidth * 0.6;
                        const left = rawW > 0 ? (startIdx + 0.5) * dayWidth : (startIdx + 0.5) * dayWidth - width / 2;
                        const showLabel = width >= 28 && laneH >= 12;
                        return (
                          <TouchableOpacity
                            key={s.memberId + s.start}
                            onPress={() => { const mm = members.find(x => x.id === s.memberId); if (mm) setSelectedMember(mm); }}
                            activeOpacity={0.7}
                            style={[styles.tlSeg, { left, width, top: s.lane * laneH + 1, height: laneH - 2, backgroundColor: avatarColor(s.name) }]}
                          >
                            {showLabel && <Text style={styles.tlSegText} numberOfLines={1} ellipsizeMode="tail">{s.name}</Text>}
                          </TouchableOpacity>
                        );
                      })}
                      {/* changeover markers (beds to remake) */}
                      {days.map(d => marks.has(d) ? (
                        <View key={'m' + d} style={[styles.tlChangeover, { left: (days.indexOf(d) + 0.5) * dayWidth }]}>
                          <Text style={styles.tlChangeoverIcon}>🛏</Text>
                        </View>
                      ) : null)}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Legend */}
          <View style={styles.tlLegend}>
            <Text style={styles.tlLegendText}>🛏 = beds to remake</Text>
            <Text style={styles.tlLegendHint}>each bar = one person's stay · stacked bars = sharing · tap a bar for details · set rooms on the People tab</Text>
          </View>

          {Platform.OS === 'web' && (
            <TouchableOpacity style={styles.printScheduleBtn} onPress={openPrintDialog} activeOpacity={0.8}>
              <Text style={styles.printScheduleBtnText}>🖨  Print room schedule</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.fleur}>⚜</Text>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headline}>La Famille</Text>
            <Text style={styles.subline}>Everyone who's part of Les Joyeux</Text>
          </View>
          {user?.isAdmin && activeTab === 'people' && (
            <TouchableOpacity
              onPress={() => setManaging(v => !v)}
              style={[styles.manageBtn, managing && styles.manageBtnActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.manageBtnText, managing && styles.manageBtnTextActive]}>
                {managing ? 'Done' : 'Manage'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* In-page tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'people' && styles.tabBtnActive]}
          onPress={() => setActiveTab('people')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, activeTab === 'people' && styles.tabBtnTextActive]}>
            People
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'events' && styles.tabBtnActive]}
          onPress={() => setActiveTab('events')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, activeTab === 'events' && styles.tabBtnTextActive]}>
            Events
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'rooms' && styles.tabBtnActive]}
          onPress={() => setActiveTab('rooms')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, activeTab === 'rooms' && styles.tabBtnTextActive]}>
            Rooms
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'people' && user?.isAdmin && <NotificationBanner userId={user.id} />}

      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator color="#C85A2E" size="large" />
        </View>
      ) : fetchError ? (
        <View style={styles.centred}>
          <Text style={styles.errorText}>⚠️ {fetchError}</Text>
          <TouchableOpacity onPress={() => fetchAll()} style={{ marginTop: 16 }}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
          {user?.isOwner && (
            <View style={[styles.migrateCard, { marginTop: 32 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.migrateLabel}>Database migrations</Text>
                {migrateResult && (
                  <Text style={[styles.migrateResult, migrateResult.ok ? styles.migrateResultOk : styles.migrateResultErr]}>
                    {migrateResult.message}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={[styles.migrateBtn, isMigrating && styles.migrateBtnBusy]}
                onPress={runMigrate}
                disabled={isMigrating}
                activeOpacity={0.8}
              >
                {isMigrating
                  ? <ActivityIndicator color="#5C3D2E" size="small" />
                  : <Text style={styles.migrateBtnText}>Run</Text>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : activeTab === 'people' ? renderPeopleTab()
        : activeTab === 'events' ? renderEventsTab()
        : renderRoomsTab()}

      <MemberDetailModal member={selectedMember} onClose={() => setSelectedMember(null)} />
      <SegmentEditorModal
        member={members.find(m => m.id === segmentMemberId) ?? null}
        busy={!!segmentMemberId && roomBusyId === segmentMemberId}
        onAdd={(seg) => { if (segmentMemberId) addAllocation(segmentMemberId, seg); }}
        onUpdate={(id, patch) => { if (segmentMemberId) updateAllocation(segmentMemberId, id, patch); }}
        onRemove={(id) => { if (segmentMemberId) removeAllocation(segmentMemberId, id); }}
        onClose={() => setSegmentMemberId(null)}
      />
      <RoomPrintModal
        visible={printOpen}
        from={printFrom}
        to={printTo}
        hideEmpty={printHideEmpty}
        onChangeFrom={setPrintFrom}
        onChangeTo={setPrintTo}
        onToggleHideEmpty={() => setPrintHideEmpty(v => !v)}
        onPrint={() => { printRoomAllocation(members, printFrom, printTo, printHideEmpty); setPrintOpen(false); }}
        onClose={() => setPrintOpen(false)}
      />
      <VisitDatesModal
        member={datesForMember}
        busy={!!datesForMember && datesBusyId === datesForMember.id}
        onSave={(a, d) => { if (datesForMember) changeVisitDates(datesForMember.id, a, d); }}
        onClose={() => setDatesForMember(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5EDD6' },
  header: {
    paddingTop: 32, paddingHorizontal: 28, paddingBottom: 20,
    borderBottomWidth: 1.5, borderBottomColor: '#EDD9A3',
  },
  fleur: { fontSize: 18, color: '#C8973D', marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  manageBtn: {
    borderWidth: 1.5, borderColor: '#C8973D', borderRadius: 50,
    paddingVertical: 7, paddingHorizontal: 16, marginBottom: 4,
  },
  manageBtnActive: { backgroundColor: '#2D5A3D', borderColor: '#2D5A3D' },
  manageBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C8973D', letterSpacing: 0.3 },
  manageBtnTextActive: { color: '#F5EDD6' },
  headline: {
    fontSize: 32, fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic', color: '#1A1209', lineHeight: 40,
  },
  subline: {
    fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245', marginTop: 4, letterSpacing: 0.3,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#F5EDD6',
    borderBottomWidth: 1,
    borderBottomColor: '#EDD9A3',
  },
  tabBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 50,
    borderWidth: 1.5, borderColor: '#EDD9A3',
    alignItems: 'center', backgroundColor: '#FAF4E6',
  },
  tabBtnActive: { backgroundColor: '#2D5A3D', borderColor: '#2D5A3D' },
  tabBtnText: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#B8956A', letterSpacing: 0.3 },
  tabBtnTextActive: { color: '#F5EDD6' },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 20, paddingBottom: 48, gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 18, padding: 16, gap: 14,
    shadowColor: '#1A1209', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 10, elevation: 3,
    borderWidth: 1, borderColor: '#EDD9A3',
  },
  avatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarImg: { width: 48, height: 48, borderRadius: 24, flexShrink: 0 },
  avatarText: { fontSize: 17, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  memberName: { fontSize: 16, fontFamily: 'Playfair Display, Georgia, serif', fontWeight: '700', color: '#1A1209' },
  adminBadge: { backgroundColor: '#EDD9A3', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  adminBadgeText: { fontSize: 10, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#8B6245', letterSpacing: 0.5 },
  roleBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  roleBadgeText: { fontSize: 10, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', letterSpacing: 0.5 },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleChip: { flex: 1, paddingVertical: 8, borderRadius: 50, borderWidth: 1.5, borderColor: '#EDD9A3', backgroundColor: '#FAF4E6', alignItems: 'center' },
  roleChipText: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#B8956A', letterSpacing: 0.3 },
  visitHere: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#2D5A3D', marginTop: 3 },
  visitFuture: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#C85A2E', marginTop: 3, lineHeight: 17 },
  visitLeaving: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#8B6245', lineHeight: 17 },
  visitNone: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#B8956A', marginTop: 3 },
  transportNote: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#1A6B8A', marginTop: 2, lineHeight: 17 },

  // Member detail modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,18,9,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFFDF5', borderRadius: 20, width: '100%', maxWidth: 420, paddingVertical: 24, paddingHorizontal: 24, borderWidth: 1, borderColor: '#EDD9A3', shadowColor: '#1A1209', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  modalAvatar: { width: 60, height: 60, borderRadius: 30 },
  modalAvatarCircle: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
  modalAvatarText: { fontSize: 22, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#fff' },
  modalName: { fontSize: 24, fontFamily: 'Playfair Display, Georgia, serif', fontStyle: 'italic', color: '#1A1209', lineHeight: 30 },
  modalDivider: { height: 1, backgroundColor: '#EDD9A3', marginVertical: 14 },
  modalSection: { gap: 4 },
  modalEyebrow: { fontSize: 10, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C8973D', letterSpacing: 1.5, marginBottom: 2 },
  modalDateLine: { fontSize: 18, fontFamily: 'Playfair Display, Georgia, serif', fontWeight: '700', color: '#1A1209' },
  modalSlot: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '400', color: '#5C3D2E' },
  modalHereNow: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#2D5A3D', marginTop: 2 },
  modalNote: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#2D5A3D', marginTop: 2 },
  modalTransport: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#1A6B8A', marginTop: 2 },
  modalDrinkLabel: { fontSize: 18, fontFamily: 'Playfair Display, Georgia, serif', color: '#1A1209' },
  modalNoVisit: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', color: '#B8956A', fontStyle: 'italic' },
  modalDismissHint: { fontSize: 11, fontFamily: 'Raleway, system-ui, sans-serif', color: '#C8A96A', textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  summaryCard: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 4,
    backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#EDD9A3',
    padding: 16, gap: 2,
  },
  summaryCardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryCardTitle: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#1A1209' },
  summaryCardSub: { fontSize: 11, fontFamily: 'Raleway, system-ui, sans-serif', color: '#B8956A', marginBottom: 10 },
  summaryCardRows: { gap: 6 },
  summaryCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryCardIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  summaryCardLabel: { flex: 1, fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', color: '#1A1209' },
  summaryCardBadge: {
    backgroundColor: '#2D5A3D', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  summaryCardBadgeText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#FFFFFF' },
  drinkBadgeWrap: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 6 },
  drinkBadge: { fontSize: 22 },
  drinkBadgeLabel: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#8B6245' },
  removeBtn: {
    borderWidth: 1.5, borderColor: '#C85A2E', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 50, minWidth: 78, alignItems: 'center', flexShrink: 0,
  },
  removeBtnBusy: { opacity: 0.5 },
  removeBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C85A2E', letterSpacing: 0.3 },
  rejectBtn: {
    borderWidth: 1.5, borderColor: '#C85A2E', paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 50, minWidth: 64, alignItems: 'center', flexShrink: 0,
  },
  rejectBtnBusy: { opacity: 0.5 },
  rejectBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C85A2E', letterSpacing: 0.3 },
  approveBtn: {
    backgroundColor: '#2D5A3D', paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 50, minWidth: 90, alignItems: 'center', flexShrink: 0,
  },
  approveBtnBusy: { backgroundColor: '#4A7A5A', opacity: 0.8 },
  approveBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#F5EDD6', letterSpacing: 0.3 },
  sectionDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  sectionDividerLine: { flex: 1, height: 1, backgroundColor: '#EDD9A3' },
  sectionDividerLabel: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C8973D', letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontFamily: 'Playfair Display, Georgia, serif', fontStyle: 'italic', color: '#1A1209', marginBottom: 8 },
  emptyBody: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', color: '#8B6245', textAlign: 'center', lineHeight: 22 },
  allClear: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', color: '#B8956A', textAlign: 'center', fontStyle: 'italic', marginTop: 6 },
  testBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#E8F4FD', borderWidth: 1, borderColor: '#A8C8E8' },
  testBadgeText: { fontSize: 9, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#2A6090', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  testDataCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 24, padding: 14, backgroundColor: '#EDF6FF', borderRadius: 12, borderWidth: 1, borderColor: '#A8C8E8' },
  testDataLabel: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#2A6090' },
  testDataMessage: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#2D5A3D', marginTop: 3 },
  testDataBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 50, borderWidth: 1.5, borderColor: '#A8C8E8', alignItems: 'center' },
  testDataClearBtn: { borderColor: '#C85A2E' },
  testDataBtnBusy: { opacity: 0.5 },
  testDataBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#2A6090' },
  migrateCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 24, marginBottom: 8, padding: 14, backgroundColor: '#FAF4E6', borderRadius: 12, borderWidth: 1, borderColor: '#EDD9A3' },
  migrateLabel: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#8B6245' },
  migrateResult: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', marginTop: 3 },
  migrateResultOk: { color: '#2D5A3D' },
  migrateResultErr: { color: '#C85A2E' },
  migrateBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 50, borderWidth: 1.5, borderColor: '#C8973D', minWidth: 56, alignItems: 'center' },
  migrateBtnBusy: { opacity: 0.6 },
  migrateBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#5C3D2E' },
  errorText: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', color: '#C85A2E', textAlign: 'center', paddingHorizontal: 32 },
  retryText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C85A2E', textDecorationLine: 'underline' },
  // Events tab
  eventDateSection: {
    backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#EDD9A3',
    overflow: 'hidden',
  },
  eventDateSectionPast: { borderColor: '#F0E8CC' },
  eventDateHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#F5EDD6',
    backgroundColor: '#FAF6EC',
  },
  eventDateLabel: {
    flex: 1, fontSize: 15,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700', color: '#1A1209',
  },
  eventDateLabelToday: { color: '#2D5A3D' },
  eventDateLabelPast: { color: '#B8956A' },
  eventAddBtn: {
    borderWidth: 1.5, borderColor: '#C8973D', borderRadius: 50,
    paddingVertical: 5, paddingHorizontal: 12,
  },
  eventAddBtnText: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C8973D' },
  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#F5EDD6',
  },
  eventTimeBadge: {
    backgroundColor: '#EDD9A3', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2, flexShrink: 0,
  },
  eventTimeText: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#8B6245' },
  eventTitle: { flex: 1, fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', color: '#1A1209' },
  eventDeleteBtn: { fontSize: 14, color: '#C8973D', paddingHorizontal: 4 },
  eventNone: {
    paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#C8B89A', fontStyle: 'italic',
  },
  eventRowMovement: { backgroundColor: '#FAF6EC' },
  eventMovementIcon: { fontSize: 16, width: 24, textAlign: 'center' },
  eventMovementText: { flex: 1, fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', color: '#8B6245', fontStyle: 'italic' },
  eventAddForm: {
    padding: 14, gap: 8,
    borderTopWidth: 1, borderTopColor: '#EDD9A3',
    backgroundColor: '#FFFDF7',
  },
  eventAddInput: {
    borderWidth: 1.5, borderColor: '#EDD9A3', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#1A1209', backgroundColor: '#FFFFFF',
  },
  eventAddActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  eventCancelBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 50,
    borderWidth: 1.5, borderColor: '#C8973D', alignItems: 'center',
  },
  eventCancelBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#C8973D' },
  eventSaveBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 50,
    backgroundColor: '#2D5A3D', alignItems: 'center',
  },
  eventSaveBtnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#F5EDD6' },
  dinnerRow: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 0,
    backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#EDD9A3',
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center',
  },
  dinnerRowText: { flex: 1, fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#1A1209' },
  dinnerPrintBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  dinnerPrintBtnText: { fontSize: 20 },
  bellCard: {
    marginHorizontal: 16, marginBottom: 8, borderRadius: 12,
    backgroundColor: '#FFF8EE', borderWidth: 1.5, borderColor: '#EDD9A3', overflow: 'hidden',
  },
  bellRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  bellLabel: {
    fontSize: 14, color: '#5C3A1E', fontWeight: '600',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }),
  },
  bellCooldown: {
    fontSize: 13, color: '#B8956A',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }),
  },
  bellInput: {
    borderBottomWidth: 1, borderBottomColor: '#EDD9A3',
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, color: '#1A1209',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }),
  },
  bellBtn: {
    backgroundColor: '#C85A2E', paddingVertical: 9, paddingHorizontal: 20,
    borderRadius: 50, minWidth: 68, alignItems: 'center',
  },
  bellBtnDisabled: { backgroundColor: '#D9C9A3' },
  bellBtnText: {
    color: '#F5EDD6', fontSize: 13, fontWeight: '700',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }),
  },
  bellError: {
    fontSize: 12, color: '#C85A2E', marginTop: 2,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }),
  },

  // ── Rooms ──
  roomNote: { fontSize: 12, color: '#1A6B8A', fontWeight: '600', marginTop: 3,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  roomAssignRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDD9A3',
  },
  roomAssignLabel: { fontSize: 14, fontWeight: '600', color: '#1A1209',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  roomAssignValue: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '700', color: '#C85A2E',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },

  // Site-owner pill (4th chip in the role row)
  ownerChipActive: { backgroundColor: '#FBEFD0', borderColor: '#C8973D' },
  ownerChipTextActive: { color: '#8A6D1F', fontWeight: '700' },

  // Rooms occupancy timeline
  tlContainer: { flex: 1, backgroundColor: '#F5EDD6' },
  tlHeaderRow: { flexDirection: 'row', backgroundColor: '#FAF4E6', borderBottomWidth: 1, borderBottomColor: '#EDD9A3' },
  tlCorner: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 4, paddingTop: 8,
    borderRightWidth: 1, borderRightColor: '#EDD9A3',
  },
  tlCornerText: { fontSize: 9, fontWeight: '700', color: '#C8973D', letterSpacing: 1,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  tlHeadCell: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 5,
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#EDD9A3',
  },
  tlHeadWd: { fontSize: 9, fontWeight: '700', color: '#8B6245' },
  tlHeadDay: { fontSize: 12, fontWeight: '700', color: '#1A1209' },
  tlWeekend: { backgroundColor: '#EFE4C4' },
  tlTodayCol: { borderLeftWidth: 2, borderLeftColor: '#C85A2E' },
  tlTodayText: { color: '#C85A2E' },
  tlLeftRow: {
    flexDirection: 'row', alignItems: 'center', paddingLeft: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EDD9A3',
    borderRightWidth: 1, borderRightColor: '#EDD9A3', backgroundColor: '#FFFDF7',
  },
  tlRoomName: { fontSize: 11, fontWeight: '700', color: '#1A1209',
    fontFamily: Platform.select({ web: 'Playfair Display, Georgia, serif', default: undefined }) },
  tlRoomOwner: { fontSize: 8, fontWeight: '700', color: '#C8973D',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  tlWho: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, paddingRight: 4 },
  tlChip: { width: 17, height: 17, borderRadius: 8.5 },
  tlChipFallback: { alignItems: 'center', justifyContent: 'center' },
  tlChipText: { fontSize: 7, fontWeight: '700', color: '#fff' },
  tlWhoMore: { fontSize: 9, fontWeight: '700', color: '#8B6245', marginLeft: 1 },
  tlBarRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EDD9A3' },
  tlCell: {
    alignItems: 'center', justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#F0E6CC',
  },
  tlBar: { position: 'absolute', left: 0, right: 0, top: 9, bottom: 9, alignItems: 'center', justifyContent: 'center' },
  tlBar1: { backgroundColor: '#EAD3A7' },
  tlBar2: { backgroundColor: '#D99C5B' },
  tlBar3: { backgroundColor: '#C97C3D' },
  tlBarCount: { fontSize: 10, fontWeight: '800', color: '#4A2E12' },
  // Per-person allocation bar + label.
  tlSeg: { position: 'absolute', borderRadius: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, overflow: 'hidden' },
  tlSegText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  // Changeover marker: dashed divider at the day boundary + a bed glyph.
  tlChangeover: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderLeftColor: '#5C3D2E', borderStyle: 'dashed' },
  tlChangeoverIcon: { fontSize: 10, marginLeft: -1, marginTop: -1 },
  tlLegend: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 14, flexWrap: 'wrap' },
  tlLegendSwatch: { width: 16, height: 12, borderRadius: 3 },
  tlLegendText: { fontSize: 11, fontWeight: '700', color: '#8B6245', marginRight: 6 },
  tlLegendHint: { fontSize: 11, color: '#B8956A', flexShrink: 1, minWidth: 150,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },

  // Rooms print button + dialog
  printScheduleBtn: {
    alignSelf: 'center', marginTop: 4, marginBottom: 18, paddingVertical: 10, paddingHorizontal: 22,
    borderRadius: 50, backgroundColor: '#2D5A3D',
  },
  printScheduleBtnText: { fontSize: 14, fontWeight: '700', color: '#F5EDD6',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  printIntro: { fontSize: 13, color: '#8B6245', marginBottom: 16, lineHeight: 18,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  printRow: { flexDirection: 'row', gap: 12 },
  printField: { flex: 1 },
  printFieldLabel: { fontSize: 12, fontWeight: '700', color: '#8B6245', marginBottom: 4,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  printFieldBox: {
    borderWidth: 1, borderColor: '#EDD9A3', backgroundColor: '#FFFDF5', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 12, position: 'relative', justifyContent: 'center',
  },
  printFieldValue: { fontSize: 15, fontWeight: '600', color: '#5C3D2E',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  printCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  printCheckbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#C8973D',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDF5',
  },
  printCheckboxOn: { backgroundColor: '#C85A2E', borderColor: '#C85A2E' },
  printCheckboxTick: { color: '#fff', fontSize: 14, fontWeight: '800' },
  printCheckLabel: { flex: 1, fontSize: 14, color: '#5C3D2E',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  printGoBtn: {
    marginTop: 22, paddingVertical: 14, borderRadius: 50, backgroundColor: '#2D5A3D', alignItems: 'center',
  },
  printGoBtnText: { fontSize: 15, fontWeight: '700', color: '#F5EDD6',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  datesWarn: { marginTop: 14, fontSize: 13, color: '#C85A2E', fontWeight: '600',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },

  // Room / member picker sheet
  roomSheet: {
    backgroundColor: '#F5EDD6', borderRadius: 20, padding: 20, width: '86%', maxWidth: 420,
    borderWidth: 1, borderColor: '#EDD9A3',
  },
  roomSheetTitle: { fontSize: 20, fontWeight: '700', color: '#1A1209', marginBottom: 12,
    fontFamily: Platform.select({ web: 'Playfair Display, Georgia, serif', default: undefined }) },
  roomSheetRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: '#EDD9A3', backgroundColor: '#FFFDF5', marginBottom: 6,
  },
  roomSheetRowActive: { borderColor: '#C85A2E', backgroundColor: '#FDF8EF' },
  roomSheetRowText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#5C3D2E',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  roomSheetRowTextActive: { color: '#C85A2E' },
  roomSheetCheck: { fontSize: 16, color: '#C85A2E', fontWeight: '700' },
  roomSheetClear: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  roomSheetClearText: { fontSize: 14, color: '#B8956A', textDecorationLine: 'underline',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  roomSheetEmpty: { fontSize: 14, color: '#8B6245', fontStyle: 'italic', paddingVertical: 12,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  // Segment editor
  segDefaultRow: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F3ECDD', marginBottom: 8 },
  segDefaultText: { fontSize: 13, color: '#8B6245', fontStyle: 'italic',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  segRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: '#EDD9A3', backgroundColor: '#FFFDF5', marginBottom: 6 },
  segRoom: { fontSize: 15, fontWeight: '700', color: '#5C3D2E',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  segDates: { fontSize: 12, color: '#8B6245', marginTop: 1,
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  segAction: { fontSize: 13, fontWeight: '700', color: '#2D5A3D' },
  segRemove: { color: '#C85A2E' },
  segAddBtn: { paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1,
    borderColor: '#C8973D', borderStyle: 'dashed', marginTop: 4 },
  segAddText: { fontSize: 14, fontWeight: '700', color: '#C8973D',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
  segForm: { marginTop: 6, padding: 10, borderRadius: 12, backgroundColor: '#FBF6EA', borderWidth: 1, borderColor: '#EDD9A3' },
  segFormBtns: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  segCancelBtn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 50, borderWidth: 1, borderColor: '#EDD9A3' },
  segCancelText: { fontSize: 15, fontWeight: '700', color: '#8B6245',
    fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }) },
});

const bannerStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8ED',
    borderBottomWidth: 1, borderBottomColor: '#EDD9A3', paddingHorizontal: 20, paddingVertical: 12, gap: 10,
  },
  icon: { fontSize: 20 },
  body: { flex: 1 },
  text: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', color: '#5C3D1E', lineHeight: 18 },
  errorText: { fontSize: 11, fontFamily: 'Raleway, system-ui, sans-serif', color: '#C85A2E', marginTop: 2 },
  btn: { backgroundColor: '#C85A2E', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 50, minWidth: 72, alignItems: 'center' },
  btnBusy: { opacity: 0.7 },
  btnText: { fontSize: 13, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#F5EDD6' },
});
