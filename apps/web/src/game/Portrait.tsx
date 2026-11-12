/**
 * Cartoon candidate portrait, drawn from avatar parts (the design's Portrait component, custom mode): skin, hair style
 * and colour (short, long, bun or hijab), beard, glasses, outfit colour and tie.
 */
export type HairStyle = "short" | "long" | "bun" | "hijab";

export interface Avatar {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  beard: boolean;
  glasses: boolean;
  outfit: string;
  tie: boolean;
  bg: string;
}

export const DEFAULT_AVATAR: Avatar = { skin: "#d9a178", hair: "#2a1d16", hairStyle: "short", beard: false, glasses: false, outfit: "#2b3a67", tie: true, bg: "#2f6fdf" };

export const SKINS = ["#f6d5b8", "#f2c39b", "#e2b08a", "#d9a178", "#c48c62", "#a8704a", "#8d5a3b", "#6b4630"];
export const HAIRS = ["#1a1414", "#2a1d16", "#3b2a20", "#6a5242", "#a3743e", "#d8a53a", "#a3a3ad", "#ecebe6", "#2e5e8c", "#7a2a3a", "#2f6b4f", "#5b3f8c"];
export const OUTFITS = ["#2b3a67", "#1c1c24", "#565662", "#7a2a3a", "#2f6b4f", "#c9a227", "#e8604c", "#f2f2f2"];
export const BACKGROUNDS = ["#2f6fdf", "#0f8a7e", "#e8604c", "#d9a21b", "#6a3fc8", "#d63f8c", "#79c9da", "#2b2440"];
export const HAIR_STYLES: { id: HairStyle; name: string }[] = [
  { id: "short", name: "Short" },
  { id: "long", name: "Long" },
  { id: "bun", name: "Bun" },
  { id: "hijab", name: "Hijab" },
];

const HAIR = "M34 42C33 27 45 21 52 23C63 23 68 32 66 42C62 34 56 31 50 32C44 32 38 36 34 42Z";
const BEARD = "M37.4 47C37.4 62.5 44.4 67 50 67C55.6 67 62.6 62.5 62.6 47C60.8 56 56.8 59.2 50 59.2C43.2 59.2 39.2 56 37.4 47Z";
const INK = "#2b2440";

/** Reads an avatar from saved data, filling anything missing or unknown with the defaults. */
export function toAvatar(data: Record<string, unknown> | undefined): Avatar {
  const d = data ?? {};
  const str = (k: keyof Avatar, ok: (v: string) => boolean) => (typeof d[k] === "string" && ok(d[k] as string) ? (d[k] as string) : (DEFAULT_AVATAR[k] as string));
  const isColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  return {
    skin: str("skin", isColor),
    hair: str("hair", isColor),
    hairStyle: str("hairStyle", (v) => HAIR_STYLES.some((h) => h.id === v)) as HairStyle,
    beard: d.beard === true,
    glasses: d.glasses === true,
    outfit: str("outfit", isColor),
    tie: d.tie !== false,
    bg: str("bg", isColor),
  };
}

export function Portrait({ avatar, size = 96, label }: { avatar: Avatar; size?: number; label: string }) {
  const a = avatar;
  const hijab = a.hairStyle === "hijab";
  // Head and ears, as in the design's default face.
  const ex1 = 35;
  const ex2 = 65;
  const ey = 46;
  const ear = (x: number) => <ellipse cx={x} cy={ey} rx={3.6} ry={5} fill={a.skin} stroke={INK} strokeWidth={2} />;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} style={{ display: "block", overflow: "visible", flexShrink: 0 }}>
      <circle cx="50" cy="50" r="47" fill={a.bg} stroke={INK} strokeWidth="4" />
      {a.hairStyle === "long" && <path d="M31 46C29 26 43 19 51 20C64 20 71 31 69 47L71 70L59 68L61 46C57 36 43 36 39 46L41 68L29 70Z" fill={a.hair} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />}
      <path d="M17 97C19 75 33 65.5 50 65.5C67 65.5 81 75 83 97Z" fill={a.outfit} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M24 90C26 80 31 74 37 71" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="44" y="55" width="12" height="13" fill={a.skin} />
      <path d="M44 63Q50 66.5 56 63L56 68L44 68Z" fill="rgba(60,30,20,0.18)" />
      <path d="M42.5 66.5L50 80L57.5 66.5Z" fill="#ffffff" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {a.tie && <path d="M48.4 67.8L51.6 67.8L52.8 79L50 82.8L47.2 79Z" fill="#c9a227" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />}
      <path d="M42.5 66.5L47 82M57.5 66.5L53 82" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      {hijab ? (
        <>
          <path d="M29 50C27 28 39 19 50 19C61 19 73 28 71 50C71 63 64 72 50 74C36 72 29 63 29 50Z" fill={a.hair} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M33 44C35 30 43 25 50 25" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="50" cy="46" rx="12.5" ry="14.5" fill={a.skin} stroke={INK} strokeWidth="2.2" />
        </>
      ) : (
        <>
          {ear(ex1)}
          {ear(ex2)}
          <ellipse cx="50" cy="44" rx="15" ry="17" fill={a.skin} stroke={INK} strokeWidth="2.4" />
          <path d="M38 51.65Q50 64.06 62 51.65Q50 60.66 38 51.65Z" fill="rgba(60,30,20,0.12)" />
        </>
      )}
      <circle cx="40.2" cy="52" r="2.6" fill="#e3826f" opacity="0.35" />
      <circle cx="59.8" cy="52" r="2.6" fill="#e3826f" opacity="0.35" />
      {a.beard && <path d={BEARD} fill={a.hair} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />}
      <path d="M40 41Q44 38.8 47.6 40.4" fill="none" stroke={hijab ? INK : a.hair} strokeWidth="2" strokeLinecap="round" />
      <path d="M52.4 40.4Q56 38.8 60 41" fill="none" stroke={hijab ? INK : a.hair} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="44" cy="45.6" rx="3.4" ry="2.6" fill="#ffffff" stroke={INK} strokeWidth="1.2" />
      <ellipse cx="56" cy="45.6" rx="3.4" ry="2.6" fill="#ffffff" stroke={INK} strokeWidth="1.2" />
      <circle cx="44.5" cy="45.9" r="1.6" fill={INK} />
      <circle cx="56.5" cy="45.9" r="1.6" fill={INK} />
      <circle cx="45" cy="45.3" r="0.5" fill="#ffffff" />
      <circle cx="57" cy="45.3" r="0.5" fill="#ffffff" />
      <path d="M50.6 46.6Q48.6 51.4 50 52.6Q51.6 53.2 53.2 51.8" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M45 54Q50 58.5 55 54" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      {!hijab && <path d={HAIR} fill={a.hair} stroke={INK} strokeWidth="2" strokeLinejoin="round" />}
      {a.hairStyle === "bun" && <circle cx="50" cy="20" r="7.5" fill={a.hair} stroke={INK} strokeWidth="2.2" />}
      {a.glasses && (
        <>
          <circle cx="44" cy="45.6" r="5.4" fill="rgba(255,255,255,0.12)" stroke={INK} strokeWidth="1.8" />
          <circle cx="56" cy="45.6" r="5.4" fill="rgba(255,255,255,0.12)" stroke={INK} strokeWidth="1.8" />
          <path d="M49.4 45.2Q50 44.4 50.6 45.2M38.6 45L35.5 44M61.4 45L64.5 44" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
