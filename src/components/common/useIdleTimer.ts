import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "wheel"];

// Fires onIdle once no mouse/keyboard activity has been seen for timeoutMs.
// Entirely inert while enabled is false - App.tsx only turns this on when
// settingsStore's vaultAutoLockEnabled is set, mirroring how auto-reconnect
// is opt-in elsewhere in the app.
export function useIdleTimer(enabled: boolean, timeoutMs: number, onIdle: () => void) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let timer: number;
    function reset() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onIdleRef.current(), timeoutMs);
    }

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset));
    reset();

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
      window.clearTimeout(timer);
    };
  }, [enabled, timeoutMs]);
}
