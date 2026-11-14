/**
 * Phones play sideways, as the designs are drawn. Held upright, a phone shows this card over the game (CSS decides
 * when: portrait, a touch screen, phone-sized). "Play full screen" also locks landscape where the browser allows it
 * (Android browsers, in full screen); elsewhere, including iPhones, turning the phone is the way.
 */
export function RotateNotice() {
  const goFull = async () => {
    try {
      await document.documentElement.requestFullscreen?.();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await orientation.lock?.("landscape");
    } catch {
      // Not allowed here (iPhones, some desktop browsers): the card still asks to turn the phone.
    }
  };
  return (
    <div className="rotate-notice" role="dialog" aria-modal="true" aria-labelledby="rotate-title" data-testid="rotate-notice">
      <div className="rotate-card">
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
          <rect x="30" y="14" width="36" height="62" rx="7" fill="#fff7e2" stroke="#2b2440" strokeWidth="4" />
          <path d="M44 66h8" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" />
          <path d="M78 40a30 30 0 0 1-10 26" fill="none" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" />
          <path d="M66 62l2 6 6-2" fill="none" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 id="rotate-title">Turn your phone sideways</h2>
        <p>Majority Map is played in landscape, so the whole map and your plan fit on screen.</p>
        <button type="button" className="primary" onClick={() => void goFull()}>
          Play full screen
        </button>
      </div>
    </div>
  );
}
