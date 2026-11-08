/**
 * Sound effects and a gentle music loop, synthesised with the Web Audio API (no audio files yet). Music and sound
 * have separate volumes from the settings. Browsers only allow audio after the player interacts, so nothing starts
 * until the first tap or key press.
 */
import { getSettings } from "./settings";

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.connect(ctx.destination);
  musicGain.connect(ctx.destination);
  applyVolumes();
  return ctx;
}

export function applyVolumes(): void {
  const s = getSettings();
  if (sfxGain) sfxGain.gain.value = s.sound * 0.25;
  if (musicGain) musicGain.gain.value = s.music * 0.08;
}

function tone(freq: number, start: number, length: number, type: OscillatorType = "triangle", target: GainNode | null = sfxGain) {
  const c = audio();
  if (!c || !target) return;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = c.currentTime + start;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, t + length);
  osc.connect(env).connect(target);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

export type Sound = "tap" | "submit" | "breaking" | "call" | "majority";

export function play(sound: Sound): void {
  if (getSettings().sound <= 0) return;
  switch (sound) {
    case "tap":
      tone(660, 0, 0.08);
      break;
    case "submit":
      tone(523, 0, 0.12);
      tone(784, 0.1, 0.18);
      break;
    case "breaking":
      tone(392, 0, 0.15, "square");
      tone(523, 0.14, 0.15, "square");
      tone(659, 0.28, 0.3, "square");
      break;
    case "call":
      tone(880, 0, 0.1, "sine");
      break;
    case "majority":
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35));
      break;
  }
}

/** A slow four-chord loop; starts after the first interaction and follows the music volume. */
export function startMusic(): void {
  if (musicTimer || getSettings().music <= 0) return;
  const c = audio();
  if (!c) return;
  void c.resume();
  const chords = [
    [261.6, 329.6, 392],
    [220, 261.6, 329.6],
    [174.6, 220, 261.6],
    [196, 246.9, 293.7],
  ];
  let i = 0;
  const playChord = () => {
    for (const f of chords[i % chords.length]!) tone(f, 0, 3.6, "sine", musicGain);
    i++;
  };
  playChord();
  musicTimer = setInterval(playChord, 4000);
}

export function stopMusic(): void {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}

/** Wire up: audio starts on the first interaction. */
export function initAudio(): void {
  const start = () => {
    audio();
    void ctx?.resume();
    startMusic();
    removeEventListener("pointerdown", start);
    removeEventListener("keydown", start);
  };
  addEventListener("pointerdown", start);
  addEventListener("keydown", start);
}
