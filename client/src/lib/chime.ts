// A short, soft two-note "ding" for new-message alerts — synthesised with the Web Audio API so
// there's no audio asset to bundle. Best-effort: browsers block audio until the user has
// interacted with the page (by which point they've navigated), and it's a no-op if the context
// can't start. Kept quiet (low gain) so it's a gentle cue, not a jingle.
let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const notes = [880, 1174.66]; // A5 → D6, a pleasant rising interval
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch {
    /* audio is a progressive enhancement — ignore failures */
  }
}
