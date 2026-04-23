import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
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

type FamilyMember = {
  id: string;
  name: string;
  isAdmin: boolean;
  arriveDate: string | null;
  arriveSlot: string | null;
  departDate: string | null;
  departSlot: string | null;
  aperitif: string | null;
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

function todayStr() { return new Date().toISOString().slice(0, 10); }

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

function MemberCard({
  member,
  onRemove,
  removing,
}: {
  member: FamilyMember;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const today = todayStr();
  const hasVisit = !!(member.arriveDate && member.departDate);
  const isHere   = hasVisit && today >= member.arriveDate! && today <= member.departDate!;
  const isFuture = hasVisit && today < member.arriveDate!;
  const days     = isFuture ? daysUntil(member.arriveDate!) : null;
  const drinkIcon = member.aperitif ? (DRINK_ICONS[member.aperitif] ?? null) : null;

  return (
    <View style={styles.card}>
      <View style={[styles.avatar, { backgroundColor: avatarColor(member.name) }]}>
        <Text style={styles.avatarText}>{initials(member.name)}</Text>
      </View>

      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName}>{member.name}</Text>
          {member.isAdmin && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>admin</Text>
            </View>
          )}
        </View>

        {isHere ? (
          <Text style={styles.visitHere}>● Here until {formatDate(member.departDate!)}</Text>
        ) : isFuture ? (
          <Text style={styles.visitFuture}>
            Arriving {formatDate(member.arriveDate!)}, {slotLabel(member.arriveSlot!)}
            {days !== null && days <= 14
              ? `  ·  ${days === 0 ? 'today!' : days === 1 ? 'tomorrow!' : `in ${days} days`}`
              : ''}
          </Text>
        ) : (
          <Text style={styles.visitNone}>No upcoming visit</Text>
        )}
      </View>

      {drinkIcon && !onRemove && <Text style={styles.drinkBadge}>{drinkIcon}</Text>}

      {onRemove && (
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
  );
}

export default function FamilyScreen() {
  const { user } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async (showRefresh = false) => {
    if (!user) return;
    if (showRefresh) setIsRefreshing(true);
    try {
      const requests: Promise<Response>[] = [
        fetch('/api/family/members', { headers: { 'x-user-id': user.id } }),
      ];
      if (user.isAdmin) {
        requests.push(fetch('/api/admin/users', { headers: { 'x-admin-id': user.id } }));
      }
      const [membersRes, pendingRes] = await Promise.all(requests);
      if (membersRes.ok) setMembers(await membersRes.json());
      if (pendingRes?.ok) setPending(await pendingRes.json());
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
      if (res.ok) setMembers(await res.json());
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.fleur}>⚜</Text>
        <Text style={styles.headline}>La Famille</Text>
        <Text style={styles.subline}>Everyone who's part of Les Joyeux</Text>
      </View>

      {user?.isAdmin && <NotificationBanner userId={user.id} />}

      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator color="#C85A2E" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={() => fetchAll(true)} tintColor="#C85A2E" />
          }
        >
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

              <View style={styles.sectionDivider}>
                <View style={styles.sectionDividerLine} />
                <Text style={styles.sectionDividerLabel}>Family members</Text>
                <View style={styles.sectionDividerLine} />
              </View>
            </>
          )}

          {members.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🌿</Text>
              <Text style={styles.emptyTitle}>Just you so far</Text>
              <Text style={styles.emptyBody}>Share the link with family to get them on board.</Text>
            </View>
          ) : (
            members.map(m => (
              <MemberCard
                key={m.id}
                member={m}
                onRemove={(user?.isAdmin && !m.isAdmin) ? () => confirmRemove(m) : undefined}
                removing={removingIds.has(m.id)}
              />
            ))
          )}

          {user?.isAdmin && pending.length === 0 && members.length > 0 && (
            <Text style={styles.allClear}>All caught up — no one waiting 🌿</Text>
          )}
        </ScrollView>
      )}
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
  headline: {
    fontSize: 32, fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic', color: '#1A1209', lineHeight: 40,
  },
  subline: {
    fontSize: 14, fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245', marginTop: 4, letterSpacing: 0.3,
  },
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
  avatarText: { fontSize: 17, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  memberName: { fontSize: 16, fontFamily: 'Playfair Display, Georgia, serif', fontWeight: '700', color: '#1A1209' },
  adminBadge: { backgroundColor: '#EDD9A3', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  adminBadgeText: { fontSize: 10, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#8B6245', letterSpacing: 0.5 },
  visitHere: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '600', color: '#2D5A3D', marginTop: 3 },
  visitFuture: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#C85A2E', marginTop: 3, lineHeight: 17 },
  visitNone: { fontSize: 12, fontFamily: 'Raleway, system-ui, sans-serif', color: '#B8956A', marginTop: 3 },
  drinkBadge: { fontSize: 28, flexShrink: 0 },
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
