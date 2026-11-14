/** Election night (suspense card, region-by-region calls, the tally racing to the majority) and the results panel. */
import { controllers, majority, meterOf, totalSeats, type AiLevel, type GameState } from "@majority-map/core";
import { textOn } from "./panels";
import { candidateName, groupName, money, pack, playerOf, presidential, trackName, votesWord } from "./model";
import type { ElectionNight as Night, GameApi } from "./useGame";

const LEVEL_NAME: Record<AiLevel, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
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

export function ResultsPanel({
  game,
  replay,
  onReplay,
  litGroup,
  onGroup,
}: {
  game: GameApi;
  replay: number;
  onReplay: (turn: number) => void;
  litGroup: string | null;
  onGroup: (groupId: string) => void;
}) {
  const night = game.election!;
  const s = night.state;
  const result = night.result;
  const gov = result.government;
  const winner = result.ranking[0]!;
  const need = majority(pack);
  const ctrl = controllers(pack, s);
  const me = game.humans[0]!;
  const lost = game.summaries.reduce((a, t) => a + (t.parties.find((p) => p.playerId === me)?.conflicts.reduce((x, c) => x + c.amount, 0) ?? 0), 0);
  const locked = Object.values(s.locked).filter((id) => id === me).length;
  const you = playerOf(s, me);
  const youTag = (id: string) => (game.solo && id === me ? " (you)" : "");
  const votes = Object.values(result.popularVote).reduce((a, b) => a + b, 0);
  const lastBoard = game.boards.length - 1;
  return (
    <section data-testid="results">
      <h2 className="results-title">
        {presidential()
          ? game.solo && winner === me
            ? "You win the presidency!"
            : `${partyName(s, winner)} wins the presidency`
          : game.solo && winner === me
            ? "You win the most seats!"
            : `${partyName(s, winner)} wins the most seats`}
      </h2>
      {game.matchHeadline && (
        <p className="headline-of-turn" data-testid="match-headline">
          <span className="breaking-tag">HEADLINE OF THE MATCH</span> {game.matchHeadline.text}
        </p>
      )}

      {s.luck && (
        <p className="small muted" data-testid="luck-note">
          Luck factor on: every seat was drawn by chance, weighted by pips with each pip of lead counting double.
        </p>
      )}
      {presidential() ? (
        <>
          <h3>The race</h3>
          <ol className="formation" data-testid="race">
            {result.ranking.map((id) => {
              const p = playerOf(s, id);
              return (
                <li key={id}>
                  <i className="chip" style={{ background: p.party.color }} />
                  {p.party.name}
                  {youTag(id)}
                  {p.eliminated !== undefined || id === result.eliminated ? (
                    <span className="muted"> · eliminated</span>
                  ) : (
                    <b>
                      {" "}
                      {result.seats[id]} {result.seats[id] === 1 ? "electoral vote" : "electoral votes"}
                    </b>
                  )}
                </li>
              );
            })}
            <li className="muted">{need} electoral votes to win.</li>
          </ol>
        </>
      ) : (
        <>
      <h3>How the government formed</h3>
      <ol className="formation" data-testid="formation">
        <li>
          <i className="chip" style={{ background: partyColor(s, gov.members[0]!) }} />
          {partyName(s, gov.members[0]!)} has the most seats: forms the government <b>{result.seats[gov.members[0]!]}</b>
        </li>
        {gov.opposition && (
          <li>
            <i className="chip" style={{ background: partyColor(s, gov.opposition) }} />
            {partyName(s, gov.opposition)} is second: main opposition <b>{result.seats[gov.opposition]}</b>
          </li>
        )}
        {gov.members.slice(1).map((id) => (
          <li key={id}>
            <i className="chip" style={{ background: partyColor(s, id) }} />
            {partyName(s, id)} joins the government <b>+{result.seats[id]}</b>
          </li>
        ))}
        <li className="muted">
          {gov.hasMajority
            ? `Majority reached with ${gov.seats} of ${need} needed${gov.outside.length ? `; ${gov.outside.map((id) => partyName(s, id)).join(", ")} stay outside` : ""}.`
            : `No majority even together: a minority government with ${gov.seats} seats.`}
        </li>
      </ol>
        </>
      )}

      <table className="list">
        <thead>
          <tr>
            <th>#</th>
            <th>Party</th>
            <th>{presidential() ? "EV" : "Seats"}</th>
            <th>Votes</th>
            <th>Groups</th>
          </tr>
        </thead>
        <tbody>
          {result.ranking.map((id, i) => (
            <tr key={id}>
              <td>{i + 1}</td>
              <td>
                <i className="chip" style={{ background: partyColor(s, id) }} />
                {partyName(s, id)}
                {youTag(id)}
              </td>
              <td>
                <b>{result.seats[id]}</b>
              </td>
              <td>{votes ? Math.round((100 * (result.popularVote[id] ?? 0)) / votes) : 0}%</td>
              <td title={Object.entries(ctrl).filter(([, o]) => o === id).map(([g]) => groupName(g)).join(", ")}>{Object.values(ctrl).filter((o) => o === id).length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Groups on the map</h3>
      <p className="small muted">Pick a group to show its regions on the seat map.</p>
      <ul className="result-groups" data-testid="result-groups">
        {pack.groups
          .filter((g) => g.kind === "state")
          .map((g) => {
            const won: Record<string, number> = {};
            for (const r of g.regions) for (const [id, n] of Object.entries(result.regionSeats[r] ?? {})) won[id] = (won[id] ?? 0) + n;
            const top = Object.entries(won)
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3);
            const owner = ctrl[g.id];
            return (
              <li key={g.id}>
                <button type="button" aria-pressed={litGroup === g.id} onClick={() => onGroup(g.id)} data-testid={`result-group-${g.id}`}>
                  <span className="rg-name">
                    <i className="chip" style={{ background: owner ? partyColor(s, owner) : "#fff" }} title={owner ? `Held by ${partyName(s, owner)}` : "Nobody holds it"} />
                    {g.name}
                  </span>
                  <span className="rg-seats">{top.map(([id, n]) => `${partyName(s, id)} ${n}`).join(" · ") || (presidential() ? "No states won" : "No seats won")}</span>
                </button>
              </li>
            );
          })}
      </ul>

      <h3>{game.solo ? "Your match" : `${you.party.name}'s match`}</h3>
      <div className="stats" data-testid="stats">
        <div>
          <small>SPENT</small>
          <b>{money(you.spent)}</b>
        </div>
        <div>
          <small>LOST IN CONFLICTS</small>
          <b>{money(lost)}</b>
        </div>
        <div>
          <small>REGIONS LOCKED</small>
          <b>{locked}</b>
        </div>
        <div>
          <small>TURNS</small>
          <b>{game.summaries.length}</b>
        </div>
      </div>

      <div className="replay">
        <label htmlFor="replay">
          Replay the map: {replay >= lastBoard ? "final result" : replay === 0 ? "start" : `after turn ${replay}`}
        </label>
        <input id="replay" type="range" min={0} max={lastBoard} value={replay} onChange={(e) => onReplay(Number(e.target.value))} data-testid="replay" />
      </div>

      {!game.online && <div className="again">
        <label htmlFor="level">Rematch</label>
        <select id="level" defaultValue={game.level} data-testid="level">
          {(["easy", "normal", "hard"] as const).map((l) => (
            <option key={l} value={l}>
              {LEVEL_NAME[l]} opponents
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary"
          onClick={() => game.restart((document.getElementById("level") as HTMLSelectElement | null)?.value as AiLevel | undefined)}
        >
          Play again
        </button>
      </div>}
    </section>
  );
}

/** The seats line on a call card: "57 seats" when one party took them all, otherwise each party's share. */
function seatLine(won: [string, number][], name: (id: string) => string): string {
  if (won.length === 0) return "No votes cast";
  if (won.length === 1) return `${won[0]![1]} ${won[0]![1] === 1 ? "seat" : "seats"}`;
  return `Seats: ${won.map(([id, n]) => `${name(id)} ${n}`).join(" · ")}`;
}
