import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

const DRINK_ICONS: Record<string, string> = {
  pastis: '🌿', kir: '💜', kir_royale: '🥂', cremant: '🍾',
  lillet: '🍸', suze: '🌼', red_wine: '🍷', white_wine: '🫗',
  rose: '🌸', gt: '🧊', beer: '🍺', sparkling: '💧',
  oj: '🍊', lemonade: '🍋', cola: '🥤',
};

const DRINK_LABELS: Record<string, string> = {
  pastis: 'Pastis', kir: 'Kir', kir_royale: 'Kir Royale', cremant: 'Crémant',
  lillet: 'Lillet', suze: 'Suze', red_wine: 'Red Wine', white_wine: 'White Wine',
  rose: 'Rosé', gt: 'G&T', beer: 'Beer', sparkling: 'Sparkling',
  oj: 'OJ', lemonade: 'Lemonade', cola: 'Cola',
};

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
type TabKey = 'people' | 'events';

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
  avatar?: string | null;
};

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

function initials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_PALETTE = ['#C85A2E', '#2D5A3D', '#C8973D', '#7B3F6E', '#3A6B8A', '#8B4513'];
function avatarColor(name: string) {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function formatDateLong(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateStr: string) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00').getTime() - now.getTime()) / 86400000);
}

function timeAgo(dateStr: string) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function slotLabel(slot: string) {
  const m: Record<string, string> = {
    morning: 'morning', lunchtime: 'lunchtime',
    afternoon: 'afternoon', dinnertime: 'dinner time', evening: 'evening',
  };
  return m[slot] ?? slot;
}

function datesBetween(from: string, to: string): string[] {
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

function printAperitifs(rows: [string, number][], hereCount: number) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const rowsHtml = rows.map(([key, count]) => {
    const isUndecided = key === '__undecided__';
    const icon  = isUndecided ? '🎲' : (DRINK_ICONS[key] ?? '🍷');
    const label = isUndecided ? 'Undecided' : (DRINK_LABELS[key] ?? key);
    return `<tr><td class="icon">${icon}</td><td class="drink">${label}</td><td class="count">\xd7${count}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Tonight's Aperitifs — Les Joyeux</title><style>
@page{size:A4 portrait;margin:3cm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;color:#1A1209;background:#fff}
header{text-align:center;border-bottom:2px solid #C8973D;padding-bottom:18px;margin-bottom:24px}
.fleur{font-size:28px;color:#C8973D;display:block;margin-bottom:8px}
h1{font-size:28px;font-style:italic;color:#1A1209;margin-bottom:6px}
.subtitle{font-family:Arial,sans-serif;font-size:13px;color:#8B6245}
table{width:100%;border-collapse:collapse;margin-top:8px}
tr{border-bottom:1px solid #EDD9A3}
tr:last-child{border-bottom:none}
td{padding:14px 8px;vertical-align:middle}
.icon{font-size:28px;width:48px;text-align:center}
.drink{font-size:20px;font-style:italic}
.count{font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#2D5A3D;text-align:right;width:60px}
footer{margin-top:32px;border-top:1px solid #EDD9A3;padding-top:12px;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#B8956A}
.close-btn{display:block;margin:24px auto 0;padding:10px 28px;background:#2D5A3D;color:#F5EDD6;border:none;border-radius:50px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:0.3px}
.close-btn:hover{background:#3d7a54}
@media print{.close-btn{display:none}}
</style></head><body>
<header><span class="fleur">✸</span><h1>Tonight's Aperitifs</h1>
<p class="subtitle">${hereCount} ${hereCount === 1 ? 'person' : 'people'} here tonight  ·  ${today}</p>
</header><table>${rowsHtml}</table>
<footer>Les Joyeux</footer>
<button class="close-btn" onclick="window.close()">Close</button>
<script>window.focus();window.print();<\/script>
</body></html>`;
  const w = window.open('', '_blank', 'width=800,height=600');
  if (w) { w.document.write(html); w.document.close(); }
}

function TonightSummaryCard({ members }: { members: FamilyMember[] }) {
  const today = todayStr();
  const hereTonight = members.filter(
    m => m.arriveDate && m.departDate && today >= m.arriveDate && today <= m.departDate
  );
  if (hereTonight.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const m of hereTonight) {
    const key = m.aperitif ?? '__undecided__';
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);

  return (
    <View style={styles.summaryCard}>
      {Platform.OS === 'web' ? (
        <TouchableOpacity onPress={() => printAperitifs(rows, hereTonight.length)} activeOpacity={0.7}>
          <Text style={[styles.summaryCardTitle, styles.summaryCardTitlePrintable]}>
            {'🍹 Tonight\'s aperitifs  '}<Text style={styles.summaryCardPrintHint}>🖨</Text>
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.summaryCardTitle}>🍹 Tonight's aperitifs</Text>
      )}
      <Text style={styles.summaryCardSub}>{hereTonight.length} {hereTonight.length === 1 ? 'person' : 'people'} here tonight</Text>
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
    </View>
  );
}

function MemberCard({
  member,
  managing,
  onRemove,
  removing,
  onRoleChange,
  changingRole,
}: {
  member: FamilyMember;
  managing?: boolean;
  onRemove?: () => void;
  removing?: boolean;
  onRoleChange?: (role: Role) => void;
  changingRole?: boolean;
}) {
  const today = todayStr();
  const hasVisit = !!(member.arriveDate && member.departDate);
  const isHere   = hasVisit && today >= member.arriveDate! && today <= member.departDate!;
  const isFuture = hasVisit && today < member.arriveDate!;
  const drinkIcon = member.aperitif ? (DRINK_ICONS[member.aperitif] ?? null) : null;

  const roleConf = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.guest;

  return (
    <View style={[styles.card, (managing && onRoleChange) && { flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}>
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
          ) : (
            <Text style={styles.visitNone}>No upcoming visit</Text>
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

      {/* Role selector — admin-only, manage mode only */}
      {managing && onRoleChange && (
        <View style={styles.roleRow}>
          {(['guest', 'staff', 'admin'] as Role[]).map(r => {
            const rc = ROLE_CONFIG[r];
            const active = member.role === r;
            return (
              <TouchableOpacity
                key={r}
                style={[
                  styles.roleChip,
                  active && { backgroundColor: rc.bg, borderColor: rc.border },
                  changingRole && { opacity: 0.5 },
                ]}
                onPress={() => !active && onRoleChange(r)}
                disabled={active || changingRole}
                activeOpacity={0.7}
              >
                <Text style={[styles.roleChipText, active && { color: rc.text, fontWeight: '700' }]}>
                  {rc.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default function FamilyScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('people');
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
      // Fetch events for the current user's stay window
      const myMember = membersData.find(m => m.id === user.id);
      if (myMember?.arriveDate && myMember?.departDate) {
        setEventsLoading(true);
        try {
          const evRes = await fetch(
            `/api/events?from=${myMember.arriveDate}&to=${myMember.departDate}`,
            { headers: { 'x-user-id': user.id } }
          );
          if (evRes.ok) {
            const evData = await evRes.json();
            setEvents(Array.isArray(evData) ? evData : []);
          }
        } finally {
          setEventsLoading(false);
        }
      } else {
        setEvents([]);
      }
    } catch (e: any) {
      setFetchError(e.message ?? 'Network error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

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
  const canSeeSummary = currentMember?.role === 'staff' || currentMember?.role === 'admin' || user?.isAdmin;

  const renderPeopleTab = () => (
    <ScrollView
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={() => fetchAll(true)} tintColor="#C85A2E" />
      }
    >
      {canSeeSummary && <TonightSummaryCard members={members} />}

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
    </ScrollView>
  );

  const renderEventsTab = () => {
    const today = todayStr();
    if (Platform.OS === 'web' && members.length > 0) {
      console.log('[Events] member dates:', members.map(m => ({
        name: m.name,
        arriveDate: m.arriveDate,
        departDate: m.departDate,
        arriveType: typeof m.arriveDate,
        departType: typeof m.departDate,
      })));
    }
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
        ) : !currentMember?.arriveDate ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={styles.emptyTitle}>No visit planned</Text>
            <Text style={styles.emptyBody}>Set your visit dates on the My Visit tab to see Château events.</Text>
          </View>
        ) : (
          datesBetween(currentMember.arriveDate, currentMember.departDate!).map(date => {
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
          })
        )}
      </ScrollView>
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
        </View>
      ) : activeTab === 'people' ? renderPeopleTab() : renderEventsTab()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5EDD6' },
  header: {
    paddingTop: 64, paddingHorizontal: 28, paddingBottom: 20,
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
  summaryCard: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 4,
    backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#EDD9A3',
    padding: 16, gap: 2,
  },
  summaryCardTitle: { fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#1A1209' },
  summaryCardTitlePrintable: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: '#C8973D' },
  summaryCardPrintHint: { fontSize: 13, color: '#C8973D' },
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
  drinkBadgeWrap: { alignItems: 'center', flexShrink: 0, gap: 2 },
  drinkBadge: { fontSize: 28 },
  drinkBadgeLabel: { fontSize: 10, fontFamily: 'Raleway, system-ui, sans-serif', color: '#8B6245', textAlign: 'center' },
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
