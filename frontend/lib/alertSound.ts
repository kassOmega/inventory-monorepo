// Alert sound helpers for incoming notifications.
//
// The sound is generated with the Web Audio API (no audio asset to ship) and is
// purely additive: if the browser blocks audio, the alert still shows up in the
// bell, the sticky alert bar and the tab title/favicon badge.

const SOUND_STORAGE = "notifications-sound";
const SOUND_EVENT = "notifications-sound-changed";

/** Sound is on unless the user explicitly muted it in the bell dropdown. */
export function isAlertSoundOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SOUND_STORAGE) !== "off";
}

export function setAlertSoundOn(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_STORAGE, on ? "on" : "off");
  window.dispatchEvent(new Event(SOUND_EVENT));
}

/** Subscribe to mute/unmute changes; returns the unsubscribe function. */
export function subscribeAlertSound(cb: (on: boolean) => void): () => void {
  const handler = () => cb(isAlertSoundOn());
  window.addEventListener(SOUND_EVENT, handler);
  return () => window.removeEventListener(SOUND_EVENT, handler);
}

/** Play a short two-tone chime. Best-effort — failures are ignored. */
export function playAlertSound(): void {
  if (!isAlertSoundOn()) return;
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const start = ctx.currentTime;

    [880, 1180].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = start + i * 0.18;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });

    window.setTimeout(() => void ctx.close().catch(() => undefined), 1000);
  } catch {
    // Audio is optional — never let it break the notification flow.
  }
}
