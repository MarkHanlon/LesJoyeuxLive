import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function Pending() {
  const { user, refreshStatus } = useAuth();
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Card fade-in on mount
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start();

    // Castle floating up-down
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: -14,
          duration: 1500,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
      ])
    ).start();

    // Gentle scale pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 2000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    ).start();

    // Poll for approval every 5 s
    const poll = setInterval(refreshStatus, 5000);
    return () => clearInterval(poll);
  }, []);

  const cardWebStyle =
    Platform.OS === 'web'
      ? ({ backdropFilter: 'blur(18px)' } as any)
      : undefined;

  return (
    /*
     * To use a chateau photo as background, swap this View for:
     * <ImageBackground source={require('../assets/chateau.jpg')} style={styles.bg} resizeMode="cover">
     * and close with </ImageBackground>
     */
    <View style={styles.bg}>
      {/* Simulated warm gradient layers */}
      <View style={styles.bgWarm} />
      <View style={styles.bgDark} />

      <Animated.View style={[styles.card, { opacity: fadeAnim }, cardWebStyle]}>
        {/* Animated castle */}
        <Animated.View
          style={{
            transform: [{ translateY: bounceAnim }, { scale: pulseAnim }],
          }}
        >
          <Text style={styles.castleEmoji}>🏰</Text>
        </Animated.View>

        <Text style={styles.headline}>Hang tight!</Text>

        <Text style={styles.body}>
          Mark is checking the list…{'\n'}
          you'll be in before the{'\n'}
          next aperitif. 🍷
        </Text>

        <View style={styles.divider} />

        <TouchableOpacity onPress={refreshStatus} activeOpacity={0.65}>
          <Text style={styles.checkLink}>Still waiting? Tap to check again</Text>
        </TouchableOpacity>

        {!!user?.name && (
          <Text style={styles.nameTag}>— {user.name}</Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#2A0E06',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bgWarm: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#8B3010',
    opacity: 0.55,
    // Top-heavy warm patch
    bottom: '40%',
  },
  bgDark: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1A0805',
    opacity: 0.6,
    top: '55%',
  },
  card: {
    backgroundColor: 'rgba(245, 237, 214, 0.93)',
    borderRadius: 28,
    paddingVertical: 44,
    paddingHorizontal: 36,
    marginHorizontal: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(200, 151, 61, 0.4)',
    shadowColor: '#0D0500',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 36,
    elevation: 24,
    maxWidth: 380,
    width: '100%',
  },
  castleEmoji: {
    fontSize: 76,
    marginBottom: 22,
    textAlign: 'center',
  },
  headline: {
    fontSize: 36,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    marginBottom: 18,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#5C3D2E',
    textAlign: 'center',
    lineHeight: 27,
    letterSpacing: 0.2,
  },
  divider: {
    width: 48,
    height: 2,
    backgroundColor: '#C8973D',
    borderRadius: 1,
    marginVertical: 26,
    opacity: 0.7,
  },
  checkLink: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#C85A2E',
    textDecorationLine: 'underline',
    letterSpacing: 0.3,
  },
  nameTag: {
    marginTop: 22,
    fontSize: 14,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#8B6245',
    letterSpacing: 0.5,
  },
});
