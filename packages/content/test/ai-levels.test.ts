import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARLIAMENTARY_RULES, createMatch, finishElection, planAi, resolveTurn, type AiLevel, type MapPack, type Plan } from "@majority-map/core";
import ukJson from "../packs/uk/pack.json" with { type: "json" };

const uk = ukJson as MapPack;
const LEADERS = ["keir-starmer", "kemi-badenoch", "nigel-farage", "ed-davey", "john-swinney"];

function setup(pack: MapPack, n: number, seed: number) {
  return createMatch(pack, {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, leaderId: pack.candidates[i % pack.candidates.length]!.id, party: { name: `P${i}`, color: `#00000${i}`, emblem: `e${i}` } })),
  });
}

/** Plays one AI-only UK match and returns the winner's level. */
function play(levels: AiLevel[], seed: number): AiLevel {
  let s = createMatch(uk, { seed, players: levels.map((_, i) => ({ id: `p${i}`, leaderId: LEADERS[i]!, party: { name: `P${i}`, color: `#00000${i}`, emblem: `e${i}` } })) });
  let rng = seed * 7919;
  for (let guard = 0; guard < 200; guard++) {
    if (s.phase === "election") {
      const done = finishElection(uk, s);
      s = done.state;
      if (s.phase === "finished") return levels[Number(done.result.ranking[0]!.slice(1))]!;
      continue;
    }
    const plans: Record<string, Plan> = {};
    s.players.forEach((p, i) => {
      const r = planAi(uk, s, p.id, levels[i]!, rng);
      rng = r.rng;
      plans[p.id] = r.plan;
    });
    s = resolveTurn(uk, s, plans).state;
  }
  throw new Error("match did not finish");
}

/** Share of matches won by `level` across rotating seats. Seeds are fixed, so results repeat exactly. */
function winShare(lineup: AiLevel[], level: AiLevel, n = 60): number {
  let wins = 0;
  for (let k = 0; k < n; k++) {
    const rot = k % lineup.length;
    if (play([...lineup.slice(rot), ...lineup.slice(0, rot)], 1000 + k) === level) wins++;
  }
  return wins / n;
}

describe("AI difficulty levels on the UK map (60 matches each; an even share would be a third)", () => {
  it("Normal beats Easy", () => {
    expect(winShare(["normal", "easy", "easy"], "normal")).toBeGreaterThan(0.5);
  });

  it("Hard beats Easy", () => {
    expect(winShare(["hard", "easy", "easy"], "hard")).toBeGreaterThan(0.5);
  });

  it("Hard beats Normal", () => {
    expect(winShare(["hard", "normal", "normal"], "hard")).toBeGreaterThan(0.36);
  });

  // Two Hards think alike; if they kept aiming at the same steps they would cancel each other out and win well under their
  // even share of two thirds. The balance simulator puts them at about 65% over 800 matches.
  it("two Hards don't sabotage each other against a Normal", () => {
    expect(winShare(["hard", "hard", "normal"], "hard")).toBeGreaterThan(0.55);
  });
});

describe("AI speed", () => {
  const timeFive = (pack: MapPack) => {
    const s = setup(pack, 5, 3);
    const t0 = performance.now();
    let rng = 1;
    for (const p of s.players) rng = planAi(pack, s, p.id, "hard", rng).rng;
    return performance.now() - t0;
  };

  it("five Hard AIs plan a UK turn in under a second", () => {
    expect(timeFive(uk)).toBeLessThan(1000);
  });

  it("five Hard AIs plan a turn on the 104-region Pakistan board in under a second", () => {
    const board = JSON.parse(readFileSync(new URL("../maps/pk.json", import.meta.url), "utf8")) as { regions: { id: string; name: string; seats: number }[] };
    const pk: MapPack = {
      ...uk,
      id: "pk-sample",
      rules: PARLIAMENTARY_RULES,
      regions: board.regions.map((r) => ({ id: r.id, name: r.name, seats: r.seats, baseCost: 5000 + 400 * r.seats })),
      groups: uk.groups.filter((g) => g.kind === "national"),
      candidates: uk.candidates.map((c) => ({ ...c, modifiers: Object.fromEntries(Object.entries(c.modifiers).filter(([g]) => uk.groups.find((x) => x.id === g)?.kind === "national")) })),
    };
    expect(timeFive(pk)).toBeLessThan(1000);
  });
});
