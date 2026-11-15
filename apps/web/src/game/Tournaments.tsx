/**
 * Tournaments: one cup per map, twice a year, free to enter, 24 hours a turn. Players sign up while the cup is open;
 * at the start they're seated in tables of up to four, the winner of each table goes through, and a final decides the
 * champion. Each table is an ordinary online match, opened from here.
 */
import { useCallback, useEffect, useState } from "react";
import { API_URL, ensureAccount, sessionToken } from "./cloud";

interface Cup {
  id: string;
  name: string;
  map: string;
  status: "scheduled" | "open" | "running" | "finished";
  cancelled: boolean;
  startsAt: number;
  endsBefore: number;
  opensAt: number;
  entrants: number;
  champion: string | null;
  round: number | null;
  yourRank: number | null;
  entered: boolean;
  yourTable: string | null;
}
interface Listing {
  now: number;
  tournaments: Cup[];
  minEntrants: number;
  maxEntrants: number;
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

async function call(method: string, path: string) {
  await ensureAccount().catch(() => undefined);
  return fetch(`${API_URL}${path}`, { method, headers: sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {} });
}

export function TournamentsScreen({ onBack, onOpenMatch }: { onBack: () => void; onOpenMatch: (code: string) => void }) {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const res = await call("GET", "/api/tournaments");
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Listing);
      setError("");
    } catch {
      setError("Couldn't load the tournaments. Try again in a moment.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (method: "POST" | "DELETE", id: string) => {
    const res = await call(method, `/api/tournaments/${id}/join`);
    if (!res.ok) setError(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "That didn't work.");
    await load();
  };
  return (
    <main className="setup online tournaments" data-testid="tournaments">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>Tournaments</h1>
      </header>
      <p className="small">One cup for each map, twice a year, free to enter. Everyone plays at 24 hours a turn, in tables of four: win your table to go through, until a final decides the champion. A cup needs at least {data?.minEntrants ?? 4} players.</p>
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      {data?.tournaments.map((c) => (
        <section key={c.id} className="backup cup" data-testid={`cup-${c.id}`}>
          <h2>{c.name}</h2>
          <p className="small">
            {c.status === "scheduled" && `Sign-up opens ${day(c.opensAt)}.`}
            {c.status === "open" && `Sign-up is open until ${day(c.startsAt)}. ${c.entrants} entered so far.`}
            {c.status === "running" && `Round ${c.round ?? 1} is under way. ${c.entrants} entered.`}
            {c.status === "finished" && (c.cancelled ? "Cancelled: not enough players signed up." : `Finished. Champion: ${c.champion ?? "—"}.`)}
          </p>
          {c.entered && c.yourRank !== null && c.status === "finished" && <p data-testid="cup-result">{c.yourRank === 1 ? "You are the champion!" : `You finished ${c.yourRank === 2 ? "in the final" : "this cup"}.`}</p>}
          <div className="backup-actions">
            {c.status === "open" && !c.entered && (
              <button type="button" className="primary" onClick={() => void act("POST", c.id)} data-testid={`cup-join-${c.id}`}>
                Enter for free
              </button>
            )}
            {c.status === "open" && c.entered && (
              <>
                <span data-testid={`cup-in-${c.id}`}>You're in.</span>
                <button type="button" onClick={() => void act("DELETE", c.id)}>
                  Withdraw
                </button>
              </>
            )}
            {c.status === "running" && c.yourTable && (
              <button type="button" className="primary" onClick={() => onOpenMatch(c.yourTable!)} data-testid={`cup-table-${c.id}`}>
                Open my table
              </button>
            )}
            {c.status === "running" && c.entered && !c.yourTable && <span>You're out of this cup, or waiting for the next round.</span>}
          </div>
        </section>
      ))}
    </main>
  );
}
