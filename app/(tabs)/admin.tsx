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
      navigator.serviceWorker?.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
      );
    }
  }, []);

  if (Platform.OS !== 'web' || permission === null) return null;
  if (subscribed) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      const res = await fetch('/api/push/vapid-key');
      if (!res.ok) throw new Error('Push not configured on server');
      const { publicKey } = await res.json();

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

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
        <Text style={bannerStyles.text}>
          Notifications blocked — enable them in browser settings to get alerts.
        </Text>
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
        onPress={enable}
        disabled={busy}
        activeOpacity={0.8}
      >
        {busy ? (
          <ActivityIndicator color="#F5EDD6" size="small" />
        ) : (
          <Text style={bannerStyles.btnText}>Enable</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

type Member = {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  isAdmin: boolean;
};

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_PALETTE = ['#C85A2E', '#2D5A3D', '#C8973D', '#7B3F6E', '#3A6B8A', '#8B4513'];
function avatarColor(name: string): string {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export default function AdminScreen() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const pending  = members.filter(m => m.status === 'pending');
  const approved = members.filter(m => m.status === 'approved');

  const fetchMembers = useCallback(
    async (showRefresh = false) => {
      if (!user) return;
      if (showRefresh) setIsRefreshing(true);
      try {
        const res = await fetch('/api/admin/users', {
          headers: { 'x-admin-id': user.id },
        });
        if (res.ok) setMembers(await res.json());
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function approve(memberId: string) {
    if (!user) return;
    setApprovingIds(prev => new Set(prev).add(memberId));
    try {
      const res = await fetch(`/api/admin/approve/${memberId}`, {
        method: 'POST',
        headers: { 'x-admin-id': user.id },
      });
      if (res.ok) {
        setMembers(prev =>
          prev.map(m => m.id === memberId ? { ...m, status: 'approved' } : m)
        );
      }
    } finally {
      setApprovingIds(prev => { const n = new Set(prev); n.delete(memberId); return n; });
    }
  }

  function confirmRemove(member: Member) {
    const doRemove = () => remove(member.id);
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${member.name} from the platform?`)) doRemove();
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
      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== memberId));
      }
    } finally {
      setRemovingIds(prev => { const n = new Set(prev); n.delete(memberId); return n; });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.fleur}>⚜</Text>
        <Text style={styles.headline}>Family 🚪</Text>
        <Text style={styles.subline}>Manage who has access</Text>
      </View>

      {user && <NotificationBanner userId={user.id} />}

      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator color="#C85A2E" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchMembers(true)}
              tintColor="#C85A2E"
            />
          }
        >
          {/* ── Pending section ── */}
          <SectionHeader title="Waiting to join" />
          {pending.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>No one waiting right now 🌿</Text>
            </View>
          ) : (
            pending.map(person => (
              <View key={person.id} style={styles.card}>
                <View style={[styles.avatar, { backgroundColor: avatarColor(person.name) }]}>
                  <Text style={styles.avatarText}>{initials(person.name)}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.personName}>{person.name}</Text>
                  <Text style={styles.personMeta}>Waiting · {timeAgo(person.createdAt)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.approveBtn, approvingIds.has(person.id) && styles.approveBtnBusy]}
                  onPress={() => approve(person.id)}
                  disabled={approvingIds.has(person.id)}
                  activeOpacity={0.8}
                >
                  {approvingIds.has(person.id) ? (
                    <ActivityIndicator color="#F5EDD6" size="small" />
                  ) : (
                    <Text style={styles.approveBtnText}>Approve ✓</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}

          {/* ── Approved members section ── */}
          <SectionHeader title="Family members" />
          {approved.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>No approved members yet</Text>
            </View>
          ) : (
            approved.map(person => (
              <View key={person.id} style={styles.card}>
                <View style={[styles.avatar, { backgroundColor: avatarColor(person.name) }]}>
                  <Text style={styles.avatarText}>{initials(person.name)}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.personName}>{person.name}</Text>
                  <Text style={styles.personMeta}>Member · joined {timeAgo(person.createdAt)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.removeBtn, removingIds.has(person.id) && styles.removeBtnBusy]}
                  onPress={() => confirmRemove(person)}
                  disabled={removingIds.has(person.id)}
                  activeOpacity={0.8}
                >
                  {removingIds.has(person.id) ? (
                    <ActivityIndicator color="#C85A2E" size="small" />
                  ) : (
                    <Text style={styles.removeBtnText}>Remove</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5EDD6' },
  header: {
    paddingTop: 64,
    paddingHorizontal: 28,
    paddingBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: '#EDD9A3',
  },
  fleur: { fontSize: 18, color: '#C8973D', marginBottom: 8 },
  headline: {
    fontSize: 32,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    lineHeight: 40,
  },
  subline: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 20, paddingBottom: 48, gap: 10 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C8973D',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  emptySection: {
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  emptySectionText: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#B8956A',
    fontStyle: 'italic',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#EDD9A3',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 18,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  info: { flex: 1 },
  personName: {
    fontSize: 17,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#1A1209',
  },
  personMeta: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 3,
  },
  approveBtn: {
    backgroundColor: '#2D5A3D',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 50,
    marginLeft: 10,
    minWidth: 96,
    alignItems: 'center',
    flexShrink: 0,
  },
  approveBtnBusy: { backgroundColor: '#4A7A5A', opacity: 0.8 },
  approveBtnText: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
    letterSpacing: 0.3,
  },
  removeBtn: {
    borderWidth: 1.5,
    borderColor: '#C85A2E',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 50,
    marginLeft: 10,
    minWidth: 80,
    alignItems: 'center',
    flexShrink: 0,
  },
  removeBtnBusy: { opacity: 0.5 },
  removeBtnText: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C85A2E',
    letterSpacing: 0.3,
  },
});

const bannerStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8ED',
    borderBottomWidth: 1,
    borderBottomColor: '#EDD9A3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  icon: { fontSize: 20 },
  body: { flex: 1 },
  text: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#5C3D1E',
    lineHeight: 18,
  },
  errorText: {
    fontSize: 11,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#C85A2E',
    marginTop: 2,
  },
  btn: {
    backgroundColor: '#C85A2E',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 50,
    minWidth: 72,
    alignItems: 'center',
  },
  btnBusy: { opacity: 0.7 },
  btnText: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
  },
});
