import { describe, expect, it } from "vitest";
import { createMatch, majority, moveCost, totalSeats, validatePack } from "@majority-map/core";
import type { MapPack } from "@majority-map/core";
import ukJson from "../packs/uk/pack.json" with { type: "json" };

const uk = ukJson as MapPack;

describe("UK pack", () => {
  it("validates", () => {
    expect(validatePack(uk)).toEqual([]);
  });

  it("has the real 650 seats and needs 326 for a majority", () => {
    expect(uk.regions).toHaveLength(12);
    expect(totalSeats(uk)).toBe(650);
    expect(majority(uk)).toBe(326);
  });

  it("puts every region in at least one state group", () => {
    const grouped = new Set(uk.groups.filter((g) => g.kind === "state").flatMap((g) => g.regions));
    expect(uk.regions.filter((r) => !grouped.has(r.id))).toEqual([]);
  });

  it("can start a full match and price a London move like the design (Starmer: step 10 about £42.4K)", () => {
    const s = createMatch(uk, {
      seed: 1,
      players: [
        { id: "zoogor", leaderId: "keir-starmer", party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "megaphone" } },
        { id: "ai-1", leaderId: "kemi-badenoch", party: { name: "Tea Break Party", color: "#0f4fa8", emblem: "teacup" } },
      ],
    });
    const cost = moveCost(uk, s.players[0]!, "lon", 9, 10);
    expect(Math.round(cost / 100) / 10).toBe(42.4);
  });
});

describe("validator", () => {
  it("catches a deliberately broken pack", () => {
    const broken: MapPack = structuredClone(uk);
    broken.regions[1]!.id = broken.regions[0]!.id;
    broken.regions[2]!.seats = 0;
    broken.groups[0]!.regions.push("atlantis");
    broken.candidates[0]!.modifiers.nowhere = 10;
    broken.candidates[1]!.modifiers.north = 80;
    broken.rules.firstEntryMax = 3;
    broken.aiPartyNames = ["Tea Break Party", "tea break party"];
    const paths = validatePack(broken).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "rules.firstEntryMax",
        "regions[1].id",
        "regions[2].seats",
        "groups[0].regions",
        "candidates[0].modifiers.nowhere",
        "candidates[1].modifiers.north",
        "aiPartyNames",
      ]),
    );
  });
});
