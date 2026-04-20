import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

type PendingUser = {
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
  return name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_PALETTE = ['#C85A2E', '#2D5A3D', '#C8973D', '#7B3F6E', '#3A6B8A', '#8B4513'];

function avatarColor(name: string): string {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

export default function AdminScreen() {
  const { user } = useAuth();
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  const fetchPending = useCallback(
    async (showRefresh = false) => {
      if (!user) return;
      if (showRefresh) setIsRefreshing(true);
      try {
        const res = await fetch('/api/admin/users', {
          headers: { 'x-admin-id': user.id },
        });
        if (res.ok) setPending(await res.json());
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  async function approve(userId: string) {
    if (!user) return;
    setApprovingIds(prev => new Set(prev).add(userId));
    try {
      await fetch(`/api/admin/approve/${userId}`, {
        method: 'POST',
        headers: { 'x-admin-id': user.id },
      });
      setPending(prev => prev.filter(u => u.id !== userId));
    } finally {
      setApprovingIds(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.fleur}>⚜</Text>
        <Text style={styles.headline}>Who's knocking? 🚪</Text>
        <Text style={styles.subline}>Family members waiting for access</Text>
      </View>

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
              onRefresh={() => fetchPending(true)}
              tintColor="#C85A2E"
            />
          }
        >
          {pending.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🌿</Text>
              <Text style={styles.emptyTitle}>All quiet</Text>
              <Text style={styles.emptyBody}>
                No one waiting to join right now.
              </Text>
            </View>
          ) : (
            pending.map(person => (
              <View key={person.id} style={styles.card}>
                <View style={[styles.avatar, { backgroundColor: avatarColor(person.name) }]}>
                  <Text style={styles.avatarText}>{initials(person.name)}</Text>
                </View>

                <View style={styles.info}>
                  <Text style={styles.personName}>{person.name}</Text>
                  <Text style={styles.personTime}>Joined {timeAgo(person.createdAt)}</Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.approveBtn,
                    approvingIds.has(person.id) && styles.approveBtnBusy,
                  ]}
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
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5EDD6',
  },
  header: {
    paddingTop: 64,
    paddingHorizontal: 28,
    paddingBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: '#EDD9A3',
  },
  fleur: {
    fontSize: 18,
    color: '#C8973D',
    marginBottom: 8,
  },
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
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 20,
    paddingBottom: 48,
    gap: 12,
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
  info: {
    flex: 1,
  },
  personName: {
    fontSize: 17,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#1A1209',
  },
  personTime: {
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
  approveBtnBusy: {
    backgroundColor: '#4A7A5A',
    opacity: 0.8,
  },
  approveBtnText: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
    letterSpacing: 0.3,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 70,
  },
  emptyEmoji: {
    fontSize: 52,
    marginBottom: 18,
  },
  emptyTitle: {
    fontSize: 24,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    marginBottom: 10,
  },
  emptyBody: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    textAlign: 'center',
    lineHeight: 23,
  },
});
