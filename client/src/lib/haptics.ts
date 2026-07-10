// Light haptic feedback via the Vibration API. Supported on Android Chrome;
// a safe no-op elsewhere (iOS Safari, desktop). Keep buzzes short and subtle.
export function haptic(pattern: number | number[] = 8): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* vibration is a progressive enhancement — ignore failures */
  }
}
