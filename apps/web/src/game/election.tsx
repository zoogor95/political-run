/** Election night: the suspense card, region-by-region calls and the tally racing to the majority. The results are in results.tsx. */
import { majority, meterOf, totalSeats, type GameState } from "@majority-map/core";
import { textOn } from "./panels";
import { candidateName, pack, playerOf, presidential, trackName, votesWord } from "./model";
import type { ElectionNight as Night } from "./useGame";

const partyName = (s: GameState, id: string) => playerOf(s, id).party.name;
const partyColor = (s: GameState, id: string) => playerOf(s, id).party.color;

export type NightPhase = "suspense" | "calling" | "done";

function Tally({ night, called, you }: { night: Night; called: number; you: string | null }) {
  const totals = called > 0 ? night.calls[called - 1]!.totals : Object.fromEntries(night.state.players.map((p) => [p.id, 0]));
  const total = totalSeats(pack);
  const need = majority(pack);
  const declared = Object.values(totals).reduce((a, b) => a + b, 0);
  const order = [...night.state.players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));
  const leader = order[0]!;
  const short = (name: string) => name.trim().split(/\s+/).slice(0, presidential() ? 2 : 1).join(" ");
  const lead = totals[leader.id] ?? 0;
  return (
    <div className="night-tally" data-testid="night-tally">
      <div className="tally" role="img" aria-label={`${presidential() ? "Electoral votes" : "Seats"} declared: ${night.state.players.map((p) => `${p.party.name} ${totals[p.id] ?? 0}`).join(", ")}`}>
        {order.map((p) => {
          const n = totals[p.id] ?? 0;
          const share = (100 * n) / total;
          return (
            <div key={p.id} style={{ width: `${share}%`, background: p.party.color, color: textOn(p.party.color), paddingLeft: n ? 10 : 0 }}>
              <span>{share >= 12 ? `${short(p.party.name)} ${n}` : share >= 3 ? n : ""}</span>
            </div>
          );
        })}
        {total - declared > 0 && <span className="not-called">{total - declared} NOT CALLED</span>}
        <em style={{ left: `${(100 * need) / total}%` }} />
      </div>
      <div className="tally-note">
        <span>
          {order
            .slice(1)
            .map((p) => `${short(p.party.name)} ${totals[p.id] ?? 0}`)
            .join(" · ")}
        </span>
        <span className="night-need">
          {need} {presidential() ? "TO WIN" : "FOR A MAJORITY"}
        </span>
        <span>
          {lead >= need
            ? `${leader.id === you ? "You have" : `${short(leader.party.name)} has`} it!`
            : lead > 0
              ? `${leader.id === you ? "You need" : `${short(leader.party.name)} needs`} ${need - lead} more`
              : "Counting under way"}
        </span>
      </div>
    </div>
  );
}

/** The popular vote so far: each declared region's voters, shared by pip share. Shown only; it never decides anything. */
function PopularSoFar({ night, called }: { night: Night; called: number }) {
  const s = night.state;
  const votes: Record<string, number> = {};
  for (const c of night.calls.slice(0, called)) {
    if (c.reserved) continue;
    const region = pack.regions.find((r) => r.id === c.regionId);
    if (!region) continue;
    const steps = s.players.map((p) => ({ id: p.id, n: meterOf(s, region.id, p.id).steps }));
    const sum = steps.reduce((a, x) => a + x.n, 0);
    if (!sum) continue;
    for (const x of steps) votes[x.id] = (votes[x.id] ?? 0) + ((region.voters ?? 0) * x.n) / sum;
  }
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${Math.round(n)}`);
  const order = [...s.players].sort((a, b) => (votes[b.id] ?? 0) - (votes[a.id] ?? 0));
  return (
    <div className="popular-so-far" data-testid="popular-so-far">
      <small>POPULAR VOTE SO FAR</small>
      {order.map((p) => (
        <div key={p.id}>
          <span>
            <i className="chip" style={{ background: p.party.color }} />
            {p.party.name}
          </span>
          <b>{fmt(votes[p.id] ?? 0)}</b>
        </div>
      ))}
    </div>
  );
}

export function ElectionNightView({
  night,
  called,
  phase,
  onSkip,
  onDone,
  you,
  humans,
  speed,
  onSpeed,
}: {
  night: Night;
  called: number;
  phase: NightPhase;
  onSkip: () => void;
  onDone: () => void;
  you: string | null;
  humans: string[];
  speed: 1 | 2;
  onSpeed: () => void;
}) {
  const s = night.state;
  const call = called > 0 ? night.calls[called - 1] : undefined;
  const result = night.result;
  const winner = result.ranking[0]!;
  const hasMajority = (result.seats[winner] ?? 0) >= majority(pack);
  const votes = Object.values(result.popularVote).reduce((a, b) => a + b, 0);
  // Presidential: every human eliminated, so the computer candidates finish the race.
  const youOut = night.continues === true && humans.every((h) => h === result.eliminated || playerOf(night.state, h).eliminated !== undefined);
  const regionCalls = night.calls.filter((c) => !c.reserved).length;
  const regionsCalled = night.calls.slice(0, called).filter((c) => !c.reserved).length;
  return (
    <>
      <div className="night-head">
        <h2>
          Election night <small>· ballot count after turn {night.turn}</small>
        </h2>
        {phase !== "done" && (
          <div className="night-buttons">
            <button type="button" onClick={onSpeed} aria-pressed={speed === 2} data-testid="night-speed">
              2× speed
            </button>
            <button type="button" className="primary" onClick={onSkip} data-testid="night-skip">
              Skip to result
            </button>
          </div>
        )}
      </div>
      <Tally night={night} called={called} you={you} />
      <PopularSoFar night={night} called={called} />
      <p className="night-progress">
        {presidential() ? "States are called east to west" : "Regions are declared one by one"} · {regionsCalled} of {regionCalls} {presidential() ? "called" : "declared"}
      </p>
      {phase === "suspense" && (
        <div className="night-card" data-testid="suspense">
          <span className="breaking-tag">ELECTION NIGHT</span>
          <b>Ballot count, turn {night.turn}: is there a winner?</b>
          {s.luck && <span className="small">Luck factor on: every seat is a draw tonight.</span>}
        </div>
      )}
      {phase === "calling" && call && (
        <div className="call-card" key={call.regionId} data-testid="call-banner">
          <span className="call-face" style={{ background: call.winner ? `color-mix(in srgb, ${partyColor(s, call.winner)} 22%, #fff)` : "#fff", borderColor: call.winner ? partyColor(s, call.winner) : "#c8bfa6" }} aria-hidden="true">
            {call.winner
              ? candidateName(playerOf(s, call.winner).leaderId)
                  .split(/\s+/)
                  .filter((w) => /^[A-Z]/.test(w))
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
              : "?"}
          </span>
          <span className="call-text">
            <small>{call.reserved ? "DECLARED" : "CALLED"}</small>
            <b>
              {trackName(call.regionId)}: {call.winner ? partyName(s, call.winner) : "nobody"}
            </b>
            <span>
              {presidential()
                ? `${Object.values(call.seats).reduce((a, b) => a + b, 0)} electoral votes`
                : seatLine(Object.entries(call.seats).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]), (id) => partyName(s, id))}
            </span>
            {call.majorityFor && (
              <em>
                {partyName(s, call.majorityFor)} passes {majority(pack)} {votesWord()}!
              </em>
            )}
          </span>
        </div>
      )}
      {phase === "done" && (
        <div className="overlay">
          <div className={`night-end${night.tie || night.continues ? " tie" : hasMajority ? " majority" : ""}`} data-testid="night-end">
            {presidential() ? (
              <PresidentialEnd night={night} you={you} />
            ) : (
              <>
                <span className="breaking-tag">{night.tie ? "DEAD HEAT" : hasMajority ? "MAJORITY" : "HUNG PARLIAMENT"}</span>
                <h2>
                  {night.tie
                    ? "Tie for most seats! A second round begins."
                    : hasMajority
                      ? `${winner === you ? "You win" : `${partyName(s, winner)} wins`} a majority!`
                      : `Hung parliament: ${partyName(s, winner)} has the most seats, but no majority`}
                </h2>
                {night.tie && <p className="muted">Every party loses 5 pips in every region, locks open, and the campaign goes on until every region is in contention again.</p>}
              </>
            )}
            <table className="list">
              <thead>
                <tr>
                  <th>{presidential() ? "Candidate" : "Party"}</th>
                  <th>{presidential() ? "Electoral votes" : "Seats"}</th>
                  <th>Popular vote</th>
                </tr>
              </thead>
              <tbody>
                {result.ranking.map((id) => (
                  <tr key={id}>
                    <td>
                      <i className="chip" style={{ background: partyColor(s, id) }} />
                      {partyName(s, id)}
                      {id === you ? " (you)" : ""}
                    </td>
                    <td>
                      <b>{result.seats[id]}</b>
                    </td>
                    <td>
                      {(result.popularVote[id] ?? 0).toLocaleString("en-GB")} ({votes ? Math.round((100 * (result.popularVote[id] ?? 0)) / votes) : 0}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" onClick={onDone} data-testid="night-done">
              {night.tie ? "Start the second round" : night.continues ? (youOut ? "See how the race ends" : "Continue the campaign") : "See the results"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Presidential end of election night: a winner, or no majority and an elimination. */
function PresidentialEnd({ night, you }: { night: Night; you: string | null }) {
  const s = night.state;
  const result = night.result;
  const winner = result.ranking[0]!;
  const out = result.eliminated;
  if (night.continues && out) {
    return (
      <>
        <span className="breaking-tag">NO MAJORITY</span>
        <h2>
          Nobody reaches {majority(pack)}. {out === you ? "You are eliminated." : `${partyName(s, out)} is eliminated.`}
        </h2>
        <p className="muted">
          {out === you ? "Your" : "Their"} pips come off the map, locks included. Everyone left plays on: a final turn again if every state is still in contention,
          otherwise the campaign continues until it is.
        </p>
      </>
    );
  }
  const lastStanding = out !== null;
  return (
    <>
      <span className="breaking-tag">{lastStanding ? "LAST ONE STANDING" : "WINNER"}</span>
      <h2>
        {winner === you ? "You win the presidency!" : `${partyName(s, winner)} wins the presidency!`}
        {lastStanding ? ` ${partyName(s, out)} is eliminated, leaving one candidate.` : ""}
      </h2>
    </>
  );
}

/** The seats line on a call card: "57 seats" when one party took them all, otherwise each party's share. */
function seatLine(won: [string, number][], name: (id: string) => string): string {
  if (won.length === 0) return "No votes cast";
  if (won.length === 1) return `${won[0]![1]} ${won[0]![1] === 1 ? "seat" : "seats"}`;
  return `Seats: ${won.map(([id, n]) => `${name(id)} ${n}`).join(" · ")}`;
}
