import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'pwa-install-dismissed';
const THEME = '#4A90D9';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): 'ios' | 'android' | null {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream) {
    return 'ios';
  }
  if (/android/i.test(ua)) {
    return 'android';
  }
  return null;
}

export default function InstallPrompt() {
  const [platform, setPlatform] = useState<'ios' | 'android' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const slideAnim = useRef(new Animated.Value(200)).current;

  useEffect(() => {
    if (isStandalone()) {
      // App is installed — clear the flag so the prompt shows again if they ever uninstall
      localStorage.removeItem(DISMISSED_KEY);
      return;
    }
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const p = detectPlatform();

    if (p === 'ios') {
      setPlatform('ios');
      slideIn();
      return;
    }

    if (p === 'android') {
      // Show banner immediately — Chrome only fires beforeinstallprompt once
      // engagement criteria are met, so we show manual instructions by default
      // and upgrade to a native install button if the event fires.
      setPlatform('android');
      slideIn();

      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  function slideIn() {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
    }).start();
  }

  function dismiss() {
    Animated.timing(slideAnim, {
      toValue: 300,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setPlatform(null);
      localStorage.setItem(DISMISSED_KEY, '1');
    });
  }

  async function handleInstall() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setPlatform(null);
      else dismiss();
      setDeferredPrompt(null);
    } else {
      dismiss();
    }
  }

  if (!platform) return null;

  return (
    <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
      {/* notch */}
      <View style={styles.notch} />

      <Text style={styles.title}>Install Les Joyeux Live</Text>

      {platform === 'android' && (
        <>
          {deferredPrompt ? (
            <>
              <Text style={styles.body}>
                Add the app to your home screen for quick access — no app store needed.
              </Text>
              <View style={styles.row}>
                <Pressable style={styles.installBtn} onPress={handleInstall}>
                  <Text style={styles.installBtnText}>Add to Home Screen</Text>
                </Pressable>
                <Pressable style={styles.dismissBtn} onPress={dismiss}>
                  <Text style={styles.dismissBtnText}>Not now</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.body}>Install this app on your home screen:</Text>
              <View style={styles.steps}>
                <Step n={1} text="Tap the menu icon ⋮ at the top-right of Chrome" />
                <Step n={2} text={'Tap “Add to Home Screen”'} />
                <Step n={3} text={'Tap “Add” to confirm'} />
              </View>
              <Pressable style={styles.dismissBtn} onPress={dismiss}>
                <Text style={styles.dismissBtnText}>Got it, I'll do this now</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      {platform === 'ios' && (
        <>
          <Text style={styles.body}>
            Install this app for quick access from your home screen:
          </Text>
          <View style={styles.steps}>
            <Step n={1} text={'Tap the Share button\u00A0\u{1F4E4} at the bottom of Safari'} />
            <Step n={2} text="Scroll down and tap \u201CAdd to Home Screen\u201D" />
            <Step n={3} text="Tap \u201CAdd\u201D to confirm" />
          </View>
          <View style={styles.iosArrow} />
          <Pressable style={styles.dismissBtn} onPress={dismiss}>
            <Text style={styles.dismissBtnText}>Got it, I\u2019ll do this now</Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNum}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'fixed' as unknown as 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 36,
    paddingTop: 12,
    boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
    elevation: 20,
    zIndex: 9999,
  },
  notch: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  installBtn: {
    flex: 1,
    backgroundColor: THEME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  installBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  dismissBtn: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  dismissBtnText: {
    color: '#888',
    fontSize: 15,
  },
  steps: {
    gap: 12,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: THEME,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNum: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
    paddingTop: 2,
  },
  iosArrow: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: THEME,
    marginBottom: 16,
  },
});
