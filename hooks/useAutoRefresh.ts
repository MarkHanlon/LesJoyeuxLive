import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Keeps a screen's data fresh without a manual pull-to-refresh or an app restart.
 *
 * While the screen is focused it:
 *  - runs `refresh` once on focus (same as the plain useFocusEffect it replaces);
 *  - re-runs `refresh` every `intervalMs`, but only while the document is visible
 *    (a backgrounded PWA / hidden tab does not poll — saves battery and DB calls);
 *  - re-runs `refresh` immediately when the PWA/tab returns to the foreground
 *    (visibilitychange), the window regains focus, or the network reconnects;
 *  - re-runs `refresh` when the service worker forwards a push (Layer 2) — so a
 *    signup/approval updates the open screen in ~1s instead of waiting for a poll.
 *
 * Web-only listeners are guarded; on native only focus + interval apply.
 *
 * Pass `enabled: false` to pause refreshing (e.g. while a form is mid-edit) so a
 * poll can never clobber unsaved input.
 */
export function useAutoRefresh(
  refresh: () => void,
  intervalMs: number,
  enabled: boolean = true,
) {
  // Hold the latest values in refs so listeners don't need re-subscribing each render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useFocusEffect(
    useCallback(() => {
      const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
      const isVisible = () =>
        !isWeb || typeof document === 'undefined' || document.visibilityState === 'visible';

      const run = () => {
        if (enabledRef.current) refreshRef.current();
      };

      // Fetch on focus.
      run();

      // Interval poll — only fires while the screen is visible.
      let timer: ReturnType<typeof setInterval> | null = null;
      const startTimer = () => {
        if (timer == null) timer = setInterval(() => { if (isVisible()) run(); }, intervalMs);
      };
      const stopTimer = () => {
        if (timer != null) { clearInterval(timer); timer = null; }
      };
      startTimer();

      // Web foreground / reconnect / push listeners.
      let cleanupWeb = () => {};
      if (isWeb) {
        const onVisibility = () => {
          if (document.visibilityState === 'visible') { run(); startTimer(); }
          else stopTimer();
        };
        const onFocus = () => run();
        const onOnline = () => run();
        const onSwMessage = (e: MessageEvent) => {
          if (e.data && e.data.type === 'refresh') run();
        };

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        window.addEventListener('online', onOnline);
        const sw = navigator.serviceWorker;
        sw?.addEventListener('message', onSwMessage);

        cleanupWeb = () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('online', onOnline);
          sw?.removeEventListener('message', onSwMessage);
        };
      }

      return () => { stopTimer(); cleanupWeb(); };
    }, [intervalMs]),
  );
}
