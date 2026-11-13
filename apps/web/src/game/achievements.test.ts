import { describe, expect, it } from "vitest";
import { countElection, createMatch, type ElectionResult, type GameState, type MapPack, type TurnEvent } from "@majority-map/core";
import ukJson from "@majority-map/content/packs/uk/pack.json";
import pkJson from "@majority-map/content/packs/pk/pack.json";
import { EMPTY_STATS, afterMatch, afterTurn, type Table } from "./achievements";

const uk = ukJson as unknown as MapPack;
const pk = pkJson as unknown as MapPack;

function match(pack: MapPack, leaders: string[]): GameState {
  return createMatch(pack, { seed: 1, players: leaders.map((leaderId, i) => ({ id: i === 0 ? "you" : `ai${i}`, leaderId, party: { name: `P${i}`, color: `#00000${i}`, emblem: `e${i}` } })) });
}

/** Gives each party these steps in every region, so seats split in proportion. */
function withSteps(state: GameState, pack: MapPack, steps: Record<string, number>): GameState {
  const s = structuredClone(state);
  for (const r of pack.regions) for (const [id, n] of Object.entries(steps)) s.meters[r.id]![id] = { steps: n, reached: Array.from({ length: n }, () => 2), entered: n > 0 };
  return s;
}

const table = (pack: MapPack, ai: Table["ai"] = ["easy"], extra: Partial<Table> = {}): Table => ({ pack, humans: ["you"], ai, passAndPlay: false, ownCandidate: false, ...extra });

describe("achievements after a turn", () => {
  it("counts locked regions, groups won and clashes, and unlocks the matching achievements", () => {
    const s = match(uk, ["keir-starmer", "kemi-badenoch"]);
    const events: TurnEvent[] = [
      { type: "locked", regionId: "lon", playerId: "you" },
      { type: "control_gained", groupId: "unions", playerId: "you" },
      { type: "control_gained", groupId: "london", playerId: "ai1" },
      { type: "conflict", regionId: "nw", step: 2, playerIds: ["you", "ai1"], costs: { you: 1, ai1: 1 } },
    ];
    const out = afterTurn(table(uk), s, events, EMPTY_STATS);
    expect(out.stats).toMatchObject({ turns: 1, regionsLocked: 1, groupsWon: 1, clashes: 1 });
    expect(out.earned.sort()).toEqual(["locked-in", "voter-group"]);
  });
});

describe("achievements after a match", () => {
  const count = (pack: MapPack, steps: Record<string, number>, leaders = ["keir-starmer", "kemi-badenoch"]): ElectionResult =>
    countElection(pack, { ...withSteps(match(pack, leaders), pack, steps), phase: "election" });

  it("a landslide majority win earns the win, majority and landslide, and counts in the stats", () => {
    const r = count(uk, { you: 4, ai1: 1 }); // 80% of the steps everywhere
    const out = afterMatch(table(uk, ["hard"]), r, EMPTY_STATS, { clashed: false, secondRound: false });
    expect(out.earned).toEqual(expect.arrayContaining(["first-win", "majority", "landslide", "beat-hard", "clean-campaign"]));
    expect(out.earned).not.toContain("coalition");
    expect(out.stats).toMatchObject({ matches: 1, wins: 1, majorities: 1, maps: { uk: { played: 1, won: 1 } }, winsVs: { hard: 1 } });
  });

  it("a narrow win without a majority is a coalition and a photo finish; a clash rules out a clean campaign", () => {
    const r = count(uk, { you: 3, ai1: 3, ai2: 2 }, ["keir-starmer", "kemi-badenoch", "ed-davey"]);
    const you = r.seats.you ?? 0;
    expect(r.ranking[0]).toBe("you"); // ties in every region go to seat order
    const out = afterMatch(table(uk, ["easy", "easy"]), r, EMPTY_STATS, { clashed: true, secondRound: true });
    expect(you).toBeLessThan(326);
    expect(out.earned).toEqual(expect.arrayContaining(["first-win", "coalition", "second-round"]));
    expect(out.earned).not.toContain("clean-campaign");
  });

  it("a loss counts as played, and pass and play and ten matches earn their own", () => {
    const r = count(uk, { you: 1, ai1: 4 });
    const out = afterMatch(table(uk, ["easy"], { passAndPlay: true }), r, { ...EMPTY_STATS, matches: 9 }, { clashed: false, secondRound: false });
    expect(out.earned.sort()).toEqual(["pass-the-phone", "veteran"]);
    expect(out.stats).toMatchObject({ matches: 10, wins: 0, passAndPlay: 1, maps: { uk: { played: 1, won: 0 } } });
  });

  it("wins on both maps, and the most reserved seats on Pakistan", () => {
    const r = count(pk, { you: 4, ai1: 1 }, ["maryam-nawaz", "imran-khan"]);
    const out = afterMatch(table(pk), r, { ...EMPTY_STATS, maps: { uk: { played: 1, won: 1 } } }, { clashed: false, secondRound: false });
    expect(out.earned).toEqual(expect.arrayContaining(["two-maps", "reserved"]));
  });
});
