/** Election night (suspense card, region-by-region calls, the tally racing to the majority) and the results panel. */
import { controllers, majority, totalSeats, type AiLevel, type GameState } from "@majority-map/core";
import { groupName, money, pack, playerOf, trackName } from "./model";
import type { ElectionNight as Night, GameApi } from "./useGame";

const LEVEL_NAME: Record<AiLevel, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const partyName = (s: GameState, id: string) => playerOf(s, id).party.name;
const partyColor = (s: GameState, id: string) => playerOf(s, id).party.color;

export type NightPhase = "suspense" | "calling" | "done";

function Tally({ night, called }: { night: Night; called: number }) {
  const totals = called > 0 ? night.calls[called - 1]!.totals : Object.fromEntries(night.state.players.map((p) => [p.id, 0]));
  const total = totalSeats(pack);
  const need = majority(pack);
  const regionCalls = night.calls.filter((c) => !c.reserved).length;
  const regionsCalled = night.calls.slice(0, called).filter((c) => !c.reserved).length;
  const reservedCalled = called - regionsCalled;
  return (
    <div className="night-tally" data-testid="night-tally">
      <div className="tally" role="img" aria-label={`Seats declared: ${night.state.players.map((p) => `${p.party.name} ${totals[p.id] ?? 0}`).join(", ")}`}>
        {night.state.players.map((p) => (
          <div key={p.id} style={{ width: `${(100 * (totals[p.id] ?? 0)) / total}%`, background: p.party.color, paddingLeft: totals[p.id] ? 8 : 0 }}>
            <span>{totals[p.id] ? totals[p.id] : ""}</span>
          </div>
        ))}
        <em style={{ left: `${(100 * need) / total}%` }} />
      </div>
      <div className="tally-note">
        <span>
          {regionsCalled} of {regionCalls} regions declared
          {reservedCalled > 0 ? ` · ${reservedCalled} of ${night.calls.length - regionCalls} reserved seat lists` : ""}
        </span>
        <span>{need} FOR A MAJORITY</span>
      </div>
    </div>
  );
}

export function ElectionNightView({ night, called, phase, onSkip, onDone, you }: { night: Night; called: number; phase: NightPhase; onSkip: () => void; onDone: () => void; you: string | null }) {
  const s = night.state;
  const call = called > 0 ? night.calls[called - 1] : undefined;
  const result = night.result;
  const winner = result.ranking[0]!;
  const hasMajority = (result.seats[winner] ?? 0) >= majority(pack);
  const votes = Object.values(result.popularVote).reduce((a, b) => a + b, 0);
  return (
    <>
      <Tally night={night} called={called} />
      {phase === "suspense" && (
        <div className="night-card" data-testid="suspense">
          <span className="breaking-tag">ELECTION NIGHT</span>
          <b>Ballot count, turn {night.turn}: is there a winner?</b>
        </div>
      )}
      {phase === "calling" && call && (
        <div className="call-banner" key={call.regionId} data-testid="call-banner" style={{ borderLeftColor: call.winner ? partyColor(s, call.winner) : "#c8bfa6" }}>
          <b>{trackName(call.regionId)}</b>
          <span>
            {Object.entries(call.seats)
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([id, n]) => `${partyName(s, id)} ${n}`)
              .join(" · ") || "No votes cast"}
          </span>
          {call.majorityFor && <em>{partyName(s, call.majorityFor)} passes {majority(pack)} seats!</em>}
        </div>
      )}
      {phase !== "done" && (
        <button type="button" className="night-skip" onClick={onSkip} data-testid="night-skip">
          Skip to the result
        </button>
      )}
      {phase === "done" && (
        <div className="overlay">
          <div className={`night-end${night.tie ? " tie" : hasMajority ? " majority" : ""}`} data-testid="night-end">
            <span className="breaking-tag">{night.tie ? "DEAD HEAT" : hasMajority ? "MAJORITY" : "HUNG PARLIAMENT"}</span>
            <h2>
              {night.tie
                ? "Tie for most seats! A second round begins."
                : hasMajority
                  ? `${winner === you ? "You win" : `${partyName(s, winner)} wins`} a majority!`
                  : `Hung parliament: ${partyName(s, winner)} has the most seats, but no majority`}
            </h2>
            {night.tie && <p className="muted">Every party loses 5 pips in every region, locks open, and the campaign goes on until every region is in contention again.</p>}
            <table className="list">
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Seats</th>
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
              {night.tie ? "Start the second round" : "See the results"}
            </button>
          </div>
        </div>
      )}
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
      <h2 className="results-title">{game.solo && winner === me ? "You win the most seats!" : `${partyName(s, winner)} wins the most seats`}</h2>
      {game.matchHeadline && (
        <p className="headline-of-turn" data-testid="match-headline">
          <span className="breaking-tag">HEADLINE OF THE MATCH</span> {game.matchHeadline.text}
        </p>
      )}

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

      <table className="list">
        <thead>
          <tr>
            <th>#</th>
            <th>Party</th>
            <th>Seats</th>
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
                  <span className="rg-seats">{top.map(([id, n]) => `${partyName(s, id)} ${n}`).join(" · ") || "No seats won"}</span>
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

      <div className="again">
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
      </div>
    </section>
  );
}
