import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { DRINK_ICONS, DRINK_LABELS } from '../../constants/drinks';
import { daysUntil, formatDate, slotLabel, todayStr } from '../../utils/date';

const HOME_REFRESH_MS = 30000;

const PHOTOS = [
  { uri: '/cheers.JPG' },
  { uri: '/chicken-pond.JPG' },
  { uri: '/simon-bra.jpg' },
  { uri: '/show.jpg' },
  { uri: '/baby-pond.jpg' },
  { uri: '/john-tutu.jpg' },
];

// Deploy check
const HOLD_MS = 3000;
const FADE_MS = 700;
const NEWS_ITEM_H = 60;
const NEWS_SCROLL_MS = 3200;

type VisitData = { arriveDate: string; arriveSlot: string; departDate: string } | null;

type Member = {
  id: string;
  name: string;
  arriveDate?: string;
  arriveSlot?: string;
  departDate?: string;
  departSlot?: string;
  aperitif?: string;
  visitUpdatedAt?: string;
};

type NewsItem = {
  key: string;
  emoji: string;
  headline: string;
  sub: string;
};

function getDrinkEmoji(key: string): string {
  return DRINK_ICONS[key] ?? '🍹';
}

function firstName(name: string): string {
  return name.split(' ')[0];
}

function buildNewsItems(members: Member[], today: string, currentUserId: string): NewsItem[] {
  const items: NewsItem[] = [];
  const others = members.filter(m => m.id !== currentUserId);
  const withVisit = others.filter(m => m.arriveDate && m.departDate);

  // Currently visiting
  const here = withVisit.filter(m => today >= m.arriveDate! && today <= m.departDate!);
  if (here.length === 1) {
    items.push({
      key: `here-${here[0].id}`,
      emoji: '🥂',
      headline: `${firstName(here[0].name)} is here right now`,
      sub: `Leaving ${formatDate(here[0].departDate!)}`,
    });
  } else if (here.length === 2) {
    items.push({
      key: 'here-2',
      emoji: '🥂',
      headline: `${firstName(here[0].name)} & ${firstName(here[1].name)} are here`,
      sub: 'La belle vie !',
    });
  } else if (here.length > 2) {
    items.push({
      key: 'here-group',
      emoji: '🥂',
      headline: `${here.length} people are here right now`,
      sub: here.map(m => firstName(m.name)).join(', '),
    });
  }

  // Leaving soon (within 2 days)
  here
    .filter(m => { const d = daysUntil(m.departDate!); return d >= 0 && d <= 2; })
    .forEach(m => {
      const d = daysUntil(m.departDate!);
      items.push({
        key: `depart-${m.id}`,
        emoji: '👋',
        headline: `${firstName(m.name)} leaves ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in 2 days'}`,
        sub: formatDate(m.departDate!),
      });
    });

  // Upcoming arrivals (sorted nearest first)
  const upcoming = withVisit
    .filter(m => m.arriveDate! > today)
    .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const d = daysUntil(next.arriveDate!);
    items.push({
      key: `arrive-${next.id}`,
      emoji: '🏡',
      headline: `${firstName(next.name)} arrives ${d === 1 ? 'tomorrow' : `in ${d} days`}`,
      sub: `${formatDate(next.arriveDate!)}, ${slotLabel(next.arriveSlot ?? 'afternoon')}`,
    });
  }

  // Drink choices — exclude people whose departure today is before dinner
  const beforeDinner = new Set(['morning', 'lunchtime', 'afternoon']);
  const hereForEvening = here.filter(m =>
    today !== m.departDate || !beforeDinner.has(m.departSlot ?? '')
  );
  const relevant = [
    ...hereForEvening,
    ...upcoming.filter(m => daysUntil(m.arriveDate!) <= 14),
  ];
  relevant
    .filter(m => m.aperitif && m.aperitif !== "I'll choose on the day!")
    .forEach(m => {
      items.push({
        key: `drink-${m.id}`,
        emoji: getDrinkEmoji(m.aperitif!),
        headline: `${firstName(m.name)} is having a ${DRINK_LABELS[m.aperitif!] ?? m.aperitif}`,
        sub: here.includes(m) ? "Tonight's choice" : 'Apéro plan',
      });
    });

  // More upcoming arrivals (2nd and 3rd)
  upcoming.slice(1, 3).forEach(m => {
    const d = daysUntil(m.arriveDate!);
    items.push({
      key: `upcoming-${m.id}`,
      emoji: '📅',
      headline: `${firstName(m.name)} is visiting soon`,
      sub: `Arriving ${formatDate(m.arriveDate!)} · ${d} day${d === 1 ? '' : 's'} away`,
    });
  });

  // Recent visit updates (within 48 h, not already featured above)
  const featuredIds = new Set(
    items.map(i => i.key.replace(/^[^-]+-/, ''))
  );
  others
    .filter(m => {
      if (!m.visitUpdatedAt) return false;
      if (featuredIds.has(m.id)) return false;
      return Date.now() - new Date(m.visitUpdatedAt).getTime() < 48 * 3_600_000;
    })
    .forEach(m => {
      items.push({
        key: `updated-${m.id}`,
        emoji: '✏️',
        headline: `${firstName(m.name)} updated their visit plans`,
        sub: 'Recently changed',
      });
    });

  if (items.length === 0) {
    items.push({
      key: 'quiet',
      emoji: '🌿',
      headline: 'All quiet on the family front',
      sub: 'No upcoming visits yet',
    });
  }

  return items;
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

  // Photo ticker
  const indexRef = useRef(0);
  const [displayIdx, setDisplayIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(0);
  const crossfade = useRef(new Animated.Value(1)).current;
  const [webIdx, setWebIdx] = useState(0);

  // Own visit state: undefined = loading, null = not set, object = set
  const [visit, setVisit] = useState<VisitData | undefined>(undefined);

  // Family members for news feed
  const [members, setMembers] = useState<Member[]>([]);

  // News auto-scroll
  const newsScrollRef = useRef<ScrollView>(null);
  const newsScrollYRef = useRef(0);

  const refresh = useCallback(() => {
    if (!user) return;
    fetch(`/api/visit/${user.id}`, { headers: { 'x-user-id': user.id } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setVisit(d?.arrive_date ? {
          arriveDate: String(d.arrive_date).slice(0, 10),
          arriveSlot: String(d.arrive_slot),
          departDate: String(d.depart_date).slice(0, 10),
        } : null);
      })
      .catch(() => setVisit(null));
    fetch('/api/family/members', { headers: { 'x-user-id': user.id } })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, [user]);

  useAutoRefresh(refresh, HOME_REFRESH_MS);

  // Auto-advance photo ticker
  useEffect(() => {
    if (Platform.OS === 'web') {
      const id = setInterval(() => setWebIdx(i => (i + 1) % PHOTOS.length), HOLD_MS + FADE_MS);
      return () => clearInterval(id);
    }
    const interval = setInterval(() => {
      const next = (indexRef.current + 1) % PHOTOS.length;
      setPrevIdx(indexRef.current);
      indexRef.current = next;
      setDisplayIdx(next);
      crossfade.setValue(0);
      Animated.timing(crossfade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    }, HOLD_MS + FADE_MS);
    return () => clearInterval(interval);
  }, [crossfade]);

  const today = todayStr();
  const days = visit?.arriveDate ? daysUntil(visit.arriveDate) : null;
  const isVisiting = !!(visit && today >= visit.arriveDate && today <= visit.departDate);
  const isPast     = !!(visit && today > visit.departDate);

  const newsItems = useMemo(
    () => buildNewsItems(members, today, user?.id ?? ''),
    [members, today, user?.id],
  );

  // Reset scroll position when news items change
  useEffect(() => {
    newsScrollYRef.current = 0;
    newsScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [newsItems]);

  // Auto-scroll news feed one item at a time
  useEffect(() => {
    if (newsItems.length <= 1) return;
    const id = setInterval(() => {
      const next = newsScrollYRef.current + NEWS_ITEM_H;
      const maxY = (newsItems.length - 1) * NEWS_ITEM_H;
      if (next > maxY) {
        newsScrollRef.current?.scrollTo({ y: 0, animated: false });
        newsScrollYRef.current = 0;
      } else {
        newsScrollRef.current?.scrollTo({ y: next, animated: true });
        newsScrollYRef.current = next;
      }
    }, NEWS_SCROLL_MS);
    return () => clearInterval(id);
  }, [newsItems]);

  const BG = 0.14;
  const bgPrev = crossfade.interpolate({ inputRange: [0, 1], outputRange: [BG, 0] });
  const bgNext = crossfade.interpolate({ inputRange: [0, 1], outputRange: [0, BG] });
  const prevOpacity = crossfade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const blur = Platform.OS === 'ios' ? 18 : 8;

  return (
    <View style={styles.container}>

      {/* ── Ambient background ── */}
      <View style={[StyleSheet.absoluteFill, styles.ambientClip]} pointerEvents="none">
        <Animated.Image source={{ uri: PHOTOS[prevIdx].uri }} style={[styles.ambientBg, { opacity: bgPrev }]} blurRadius={blur} />
        <Animated.Image source={{ uri: PHOTOS[displayIdx].uri }} style={[styles.ambientBg, { opacity: bgNext }]} blurRadius={blur} />
      </View>

      {/* ── Main content ── */}
      <View style={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.fleur}>⚜</Text>
          <Text style={styles.title}>Les Joyeux Live</Text>
          {user && <Text style={styles.greeting}>Bonjour, {user.name.split(' ')[0]} !</Text>}
        </View>

        {/* Photo ticker */}
        <View style={styles.photoCard}>
          {Platform.OS === 'web' ? (
            <>
              {PHOTOS.map((photo, i) => (
                <Image
                  key={photo.uri}
                  source={{ uri: photo.uri }}
                  style={[styles.photo, {
                    opacity: i === webIdx ? 1 : 0,
                    // @ts-ignore — web-only CSS property
                    transition: 'opacity 0.7s ease-in-out',
                  }]}
                  resizeMode="cover"
                />
              ))}
              <View style={styles.dots}>
                {PHOTOS.map((_, i) => (
                  <View key={i} style={[styles.dot, i === webIdx && styles.dotActive]} />
                ))}
              </View>
            </>
          ) : (
            <>
              <Animated.Image source={{ uri: PHOTOS[prevIdx].uri }} style={[styles.photo, { opacity: prevOpacity }]} resizeMode="cover" />
              <Animated.Image source={{ uri: PHOTOS[displayIdx].uri }} style={[styles.photo, { opacity: crossfade }]} resizeMode="cover" />
              <View style={styles.dots}>
                {PHOTOS.map((_, i) => (
                  <View key={i} style={[styles.dot, i === displayIdx && styles.dotActive]} />
                ))}
              </View>
            </>
          )}
        </View>

        {/* ── Family news ── */}
        <View style={styles.newsCard}>
          <Text style={styles.newsEyebrow}>FAMILY NEWS</Text>
          <ScrollView
            ref={newsScrollRef}
            style={styles.newsScroll}
            showsVerticalScrollIndicator={false}
          >
            {newsItems.map((item, i) => (
              <View
                key={item.key}
                style={[styles.newsItem, i < newsItems.length - 1 && styles.newsItemDivider]}
              >
                <Text style={styles.newsEmoji}>{item.emoji}</Text>
                <View style={styles.newsContent}>
                  <Text style={styles.newsHeadline}>{item.headline}</Text>
                  {item.sub ? <Text style={styles.newsSub}>{item.sub}</Text> : null}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── My visit — compact CTA ── */}
        {visit !== undefined && (
          <View style={styles.ctaCard}>
            {visit === null || isPast ? (
              <TouchableOpacity style={styles.ctaRow} onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.8}>
                <Text style={styles.ctaEmoji}>🏡</Text>
                <View style={styles.ctaTextBlock}>
                  <Text style={styles.ctaTitle}>{isPast ? 'See you again soon?' : 'Planning a visit?'}</Text>
                  <Text style={styles.ctaSub}>Tap to plan your next visit</Text>
                </View>
                <Text style={styles.ctaArrow}>→</Text>
              </TouchableOpacity>

            ) : isVisiting ? (
              <TouchableOpacity style={styles.ctaRow} onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.8}>
                <Text style={styles.ctaEmoji}>🥂</Text>
                <View style={styles.ctaTextBlock}>
                  <Text style={styles.ctaTitle}>Bienvenue !</Text>
                  <Text style={styles.ctaSub}>Leaving {formatDate(visit.departDate)}</Text>
                </View>
                <Text style={styles.editLink}>Edit →</Text>
              </TouchableOpacity>

            ) : days === 0 ? (
              <TouchableOpacity style={styles.ctaRow} onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.8}>
                <Text style={styles.ctaEmoji}>🎉</Text>
                <View style={styles.ctaTextBlock}>
                  <Text style={styles.ctaTitle}>Today's the day!</Text>
                  <Text style={styles.ctaSub}>Safe travels — see you very soon 🥂</Text>
                </View>
              </TouchableOpacity>

            ) : (
              <TouchableOpacity style={styles.ctaRow} onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.8}>
                <Text style={styles.ctaCountNum}>{days}</Text>
                <View style={styles.ctaTextBlock}>
                  <Text style={styles.ctaEyebrow}>DAYS TO GO</Text>
                  <Text style={styles.ctaSub}>
                    Arriving {formatDate(visit.arriveDate)}, {slotLabel(visit.arriveSlot)}
                  </Text>
                </View>
                <Text style={styles.editLink}>Edit →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

      </View>

      {/* Not me + build stamp pinned to bottom corners */}
      <TouchableOpacity style={styles.notMe} onPress={logout}>
        <Text style={styles.notMeText}>Not me</Text>
      </TouchableOpacity>
      {process.env.EXPO_PUBLIC_BUILD_TIME ? (
        <Text style={styles.buildStamp}>Build: {process.env.EXPO_PUBLIC_BUILD_TIME}</Text>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5EDD6',
  },

  ambientClip: {
    overflow: 'hidden',
  },
  ambientBg: {
    position: 'absolute',
    width: '150%',
    height: '150%',
    top: '-25%',
    left: '-25%',
  },

  content: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 29,
    paddingBottom: 36,
    gap: 16,
  },

  header: {
    alignItems: 'center',
    paddingBottom: 2,
  },
  fleur: {
    fontSize: 18,
    color: '#C8973D',
    marginBottom: 4,
  },
  title: {
    fontSize: 32,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    letterSpacing: 0.3,
  },
  greeting: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 3,
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },

  // Photo ticker
  photoCard: {
    height: 185,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#D9C9A3',
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 6,
  },
  photo: {
    ...StyleSheet.absoluteFillObject,
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  dotActive: {
    width: 20,
    backgroundColor: '#FFFFFF',
  },

  // Family news card
  newsCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 253, 245, 0.88)',
    borderRadius: 22,
    paddingTop: 14,
    paddingHorizontal: 18,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
    minHeight: 80,
  },
  newsEyebrow: {
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C8973D',
    letterSpacing: 2.5,
    marginBottom: 4,
  },
  newsScroll: {
    flex: 1,
  },
  newsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    height: NEWS_ITEM_H,
    gap: 12,
    overflow: 'hidden',
  },
  newsItemDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(200, 151, 61, 0.3)',
  },
  newsEmoji: {
    fontSize: 22,
    width: 30,
    textAlign: 'center',
  },
  newsContent: {
    flex: 1,
  },
  newsHeadline: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#1A1209',
  },
  newsSub: {
    fontSize: 11,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 2,
  },

  // Compact visit CTA card
  ctaCard: {
    backgroundColor: 'rgba(255, 253, 245, 0.88)',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ctaEmoji: {
    fontSize: 30,
  },
  ctaTextBlock: {
    flex: 1,
  },
  ctaTitle: {
    fontSize: 15,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
  },
  ctaSub: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 2,
  },
  ctaArrow: {
    fontSize: 18,
    color: '#C8973D',
    fontWeight: '600',
  },
  ctaCountNum: {
    fontSize: 42,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#C85A2E',
    lineHeight: 46,
    minWidth: 52,
    textAlign: 'center',
  },
  ctaEyebrow: {
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C8973D',
    letterSpacing: 2.5,
  },
  editLink: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#C85A2E',
    textDecorationLine: 'underline',
  },

  buildStamp: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#B8956A',
    letterSpacing: 0.3,
  },

  notMe: {
    position: 'absolute',
    bottom: 20,
    right: 22,
  },
  notMeText: {
    fontSize: 11,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#B8956A',
    textDecorationLine: 'underline',
  },
});
