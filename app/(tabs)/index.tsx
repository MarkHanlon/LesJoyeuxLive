import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';

// Placeholder photos — swap src array for real family photo URIs when ready
  const PHOTOS = [                                                                                                                                                                                                         
    { uri: '/cheers.JPG' },                                                                                                                                                                                                
    { uri: '/chicken-pond.JPG' },                                                                                                                                                                                          
    { uri: '/simon-bra.jpg' },                                                                                                                                                                                             
    { uri: '/show.jpg' },                                                                                                                                                                                                  
    { uri: '/baby-pond.jpg' },                                                                                                                                                                                                  
    { uri: '/john-tutu.jpg' },                                                                                                                                                                                                  
  ];  

const HOLD_MS = 3000;
const FADE_MS = 700;

type VisitData = { arriveDate: string; arriveSlot: string; departDate: string } | null;

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00').getTime() - now.getTime()) / 86400000);
}

function slotLabel(slot: string): string {
  const m: Record<string, string> = {
    morning: 'morning', lunchtime: 'lunchtime',
    afternoon: 'afternoon', dinnertime: 'dinner time', evening: 'evening',
  };
  return m[slot] ?? slot;
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

  // Photo ticker — use refs to avoid stale closures in the interval
  const indexRef = useRef(0);
  const [displayIdx, setDisplayIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(0);
  const crossfade = useRef(new Animated.Value(1)).current;

  // visit: undefined = loading, null = not set, object = set
  const [visit, setVisit] = useState<VisitData | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/visit/${user.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setVisit(d?.arrive_date ? {
          arriveDate: String(d.arrive_date).slice(0, 10),
          arriveSlot: String(d.arrive_slot),
          departDate: String(d.depart_date).slice(0, 10),
        } : null);
      })
      .catch(() => setVisit(null));
  }, [user]);

  // Auto-advance ticker with crossfade
  useEffect(() => {
    const interval = setInterval(() => {
      const next = (indexRef.current + 1) % PHOTOS.length;
      setPrevIdx(indexRef.current);
      indexRef.current = next;
      setDisplayIdx(next);
      crossfade.setValue(0);
      Animated.timing(crossfade, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start();
    }, HOLD_MS + FADE_MS);
    return () => clearInterval(interval);
  }, [crossfade]);

  const today = todayStr();
  const days = visit?.arriveDate ? daysUntil(visit.arriveDate) : null;
  const isVisiting = !!(visit && today >= visit.arriveDate && today <= visit.departDate);
  const isPast     = !!(visit && today > visit.departDate);

  // Background: prev fades out to 0, next fades in to MAX_BG_OPACITY
  const BG = 0.14;
  const bgPrev = crossfade.interpolate({ inputRange: [0, 1], outputRange: [BG, 0] });
  const bgNext = crossfade.interpolate({ inputRange: [0, 1], outputRange: [0, BG] });
  const prevOpacity = crossfade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  const blur = Platform.OS === 'ios' ? 18 : 8;

  return (
    <View style={styles.container}>

      {/* ── Ambient background: zoomed, blurred, nearly transparent ── */}
      <View style={[StyleSheet.absoluteFill, styles.ambientClip]} pointerEvents="none">
        <Animated.Image
          source={{ uri: PHOTOS[prevIdx].uri }}
          style={[styles.ambientBg, { opacity: bgPrev }]}
          blurRadius={blur}
        />
        <Animated.Image
          source={{ uri: PHOTOS[displayIdx].uri }}
          style={[styles.ambientBg, { opacity: bgNext }]}
          blurRadius={blur}
        />
      </View>

      {/* ── Main content ── */}
      <View style={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.fleur}>⚜</Text>
          <Text style={styles.title}>Les Joyeux Live</Text>
          {user && (
            <Text style={styles.greeting}>
              Bonjour, {user.name.split(' ')[0]} !
            </Text>
          )}
        </View>

        {/* Photo ticker */}
        <View style={styles.photoCard}>
          {/* Previous photo fades out */}
          <Animated.Image
            source={{ uri: PHOTOS[prevIdx].uri }}
            style={[styles.photo, { opacity: prevOpacity }]}
            resizeMode="cover"
          />
          {/* Current photo fades in */}
          <Animated.Image
            source={{ uri: PHOTOS[displayIdx].uri }}
            style={[styles.photo, { opacity: crossfade }]}
            resizeMode="cover"
          />
          {/* Progress dots */}
          <View style={styles.dots}>
            {PHOTOS.map((_, i) => (
              <View key={i} style={[styles.dot, i === displayIdx && styles.dotActive]} />
            ))}
          </View>
        </View>

        {/* CTA — only render once visit state is known */}
        {visit !== undefined && (
          <View style={styles.ctaCard}>
            {visit === null ? (
              /* No visit planned yet */
              <>
                <Text style={styles.ctaEmoji}>🏡</Text>
                <Text style={styles.ctaTitle}>Planning a visit?</Text>
                <Text style={styles.ctaBody}>
                  Let us know when to expect you —{'\n'}we'll get the apéro ready 🥂
                </Text>
                <TouchableOpacity
                  style={styles.ctaBtn}
                  onPress={() => router.push('/(tabs)/visit')}
                  activeOpacity={0.82}
                >
                  <Text style={styles.ctaBtnText}>Plan My Visit  →</Text>
                </TouchableOpacity>
              </>

            ) : isVisiting ? (
              /* Currently visiting */
              <>
                <Text style={styles.ctaEmoji}>🥂</Text>
                <Text style={styles.ctaTitle}>Bienvenue !</Text>
                <Text style={styles.ctaBody}>
                  So glad you're here.{'\n'}Leaving {formatDate(visit.departDate)}.
                </Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.7}>
                  <Text style={styles.editLink}>Edit plans</Text>
                </TouchableOpacity>
              </>

            ) : isPast ? (
              /* Past visit — prompt to plan the next one */
              <>
                <Text style={styles.ctaEmoji}>🏡</Text>
                <Text style={styles.ctaTitle}>See you again soon?</Text>
                <Text style={styles.ctaBody}>
                  Already looking forward to it. Plan your next visit!
                </Text>
                <TouchableOpacity
                  style={styles.ctaBtn}
                  onPress={() => router.push('/(tabs)/visit')}
                  activeOpacity={0.82}
                >
                  <Text style={styles.ctaBtnText}>Plan Next Visit  →</Text>
                </TouchableOpacity>
              </>

            ) : days === 0 ? (
              /* Today is arrival day */
              <>
                <Text style={styles.ctaEmoji}>🎉</Text>
                <Text style={styles.ctaTitle}>Today's the day!</Text>
                <Text style={styles.ctaBody}>Safe travels — see you very soon 🥂</Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.7}>
                  <Text style={styles.editLink}>Edit plans</Text>
                </TouchableOpacity>
              </>

            ) : (
              /* Future visit — countdown */
              <>
                <Text style={styles.ctaEyebrow}>NEXT VISIT IN</Text>
                <View style={styles.countdownRow}>
                  <Text style={styles.countdownNumber}>{days}</Text>
                  <Text style={styles.countdownUnit}>
                    {days === 1 ? 'day' : 'days'}{'\n'}to go
                  </Text>
                </View>
                <Text style={styles.ctaArriving}>
                  Arriving {formatDate(visit.arriveDate)}, {slotLabel(visit.arriveSlot)}
                </Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/visit')} activeOpacity={0.7}>
                  <Text style={styles.editLink}>Edit plans</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

      </View>

      {/* Not me */}
      <TouchableOpacity style={styles.notMe} onPress={logout}>
        <Text style={styles.notMeText}>Not me</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5EDD6',
  },

  // Ambient background
  ambientClip: {
    overflow: 'hidden',
  },
  ambientBg: {
    position: 'absolute',
    // Oversized so it looks zoomed in
    width: '150%',
    height: '150%',
    top: '-25%',
    left: '-25%',
  },

  // Main layout
  content: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 58,
    paddingBottom: 36,
    gap: 18,
  },

  // Header
  header: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  fleur: {
    fontSize: 18,
    color: '#C8973D',
    marginBottom: 6,
  },
  title: {
    fontSize: 34,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    letterSpacing: 0.3,
  },
  greeting: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 4,
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },

  // Photo ticker
  photoCard: {
    height: 220,
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
    bottom: 12,
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

  // CTA card
  ctaCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 253, 245, 0.88)',
    borderRadius: 22,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  ctaEmoji: {
    fontSize: 42,
    marginBottom: 2,
  },
  ctaTitle: {
    fontSize: 22,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    textAlign: 'center',
  },
  ctaBody: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaBtn: {
    marginTop: 6,
    backgroundColor: '#C85A2E',
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: 50,
  },
  ctaBtnText: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
    letterSpacing: 0.3,
  },
  ctaEyebrow: {
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C8973D',
    letterSpacing: 2.5,
    marginBottom: 2,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginVertical: 2,
  },
  countdownNumber: {
    fontSize: 76,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#C85A2E',
    lineHeight: 82,
  },
  countdownUnit: {
    fontSize: 16,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    lineHeight: 22,
    marginBottom: 14,
  },
  ctaArriving: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#5C3D2E',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  editLink: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#C85A2E',
    textDecorationLine: 'underline',
    marginTop: 4,
  },

  // Bottom
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
