import { createMatch, planAi, playTurn, type GameState } from "@majority-map/core";
import { describe, expect, it } from "vitest";
import { inviteCode } from "../src/api.js";
import { checkSetup, join, leave, newRoom, packFor, start, submit, timeout, view, waitingOn, type MatchSetup, type RoomData } from "../src/room.js";

const seat = (id: string, kind: "human" | "ai", leaderId: string, color: string, emblem: string) => ({
  id,
  kind,
  label: id,
  level: "normal" as const,
  party: { name: `${id} party`, color, emblem },
  leaderId,
});

const SETUP: MatchSetup = {
  map: "uk",
  seats: [seat("p1", "human", "keir-starmer", "#6a3fc8", "owl"), seat("p2", "human", "angela-rayner", "#0f8a7e", "acorn"), seat("cpu", "ai", "wes-streeting", "#e8604c", "compass")],
};

const HOST = { accountId: "host", name: "Zoogor" };
const lobby = () => newRoom("ABC123", "match-1", structuredClone(SETUP), HOST, 4242, 0);

/** A person's plan: what a Normal computer would do in their place, so the match is a real one. */
const planFor = (room: RoomData, seatId: string) => planAi(packFor(room.setup), room.state!, seatId, "normal", room.state!.turn * 7919).plan;

describe("the lobby", () => {
  it("seats the host, then friends in the free seats, and refuses anyone once it's full", () => {
    const room = lobby();
    expect(view(room, "host")).toMatchObject({ you: "p1", youHost: true, status: "lobby" });
    expect(join(room, "friend", "Ali").id).toBe("p2");
    expect(join(room, "friend", "Ali B").id).toBe("p2"); // a reload keeps the seat
    expect(() => join(room, "stranger", "Sam")).toThrow("full");
    expect(view(room, "stranger").you).toBeNull();
    leave(room, "friend");
    expect(join(room, "stranger", "Sam").id).toBe("p2");
  });

  it("starts only when the host says so and every friend's seat is taken", () => {
    const room = lobby();
    expect(() => start(room, "host")).toThrow("every friend");
    join(room, "friend", "Ali");
    expect(() => start(room, "friend")).toThrow("Only the host");
    start(room, "host");
    expect(room.status).toBe("active");
    expect(room.state!.players.map((p) => p.id)).toEqual(["p1", "p2", "cpu"]);
    expect(() => join(room, "late", "Kim")).toThrow("already started");
  });

  it("refuses setups that can't be played", () => {
    expect(() => checkSetup({ ...SETUP, map: "mars" })).toThrow("Unknown map");
    expect(() => checkSetup({ ...SETUP, seats: SETUP.seats.map((s, i) => (i === 1 ? { ...s, kind: "ai" as const } : s)) })).toThrow("friend");
    expect(() => checkSetup({ ...SETUP, seats: SETUP.seats.map((s) => ({ ...s, party: { ...s.party, color: "#000000" } })) })).toThrow("colour");
    expect(() => checkSetup({ ...SETUP, seats: SETUP.seats.map((s, i) => (i === 0 ? { ...s, leaderId: "nobody" } : s)) })).toThrow();
  });

  it("makes six-character codes that are easy to read out", () => {
    for (let i = 0; i < 50; i++) expect(inviteCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
  });
});

describe("playing the match", () => {
  it("waits for every person's plan, then resolves the turn with the computer's too and keeps plans secret till then", () => {
    const room = lobby();
    join(room, "friend", "Ali");
    start(room, "host");
    const first = submit(room, "host", 1, planFor(room, "p1"));
    expect(first.turns).toEqual([]);
    expect(view(room, "friend")).toMatchObject({ submitted: ["p1"], yourPlan: null });
    expect(view(room, "host").yourPlan).not.toBeNull();
    const second = submit(room, "friend", 1, planFor(room, "p2"));
    expect(second.turns).toHaveLength(1);
    expect(Object.keys(second.turns[0]!.plans).sort()).toEqual(["cpu", "p1", "p2"]);
    expect(room.state!.turn).toBe(2);
    expect(view(room, "host")).toMatchObject({ submitted: [], turnsPlayed: 1 });
  });

  it("refuses plans for the wrong turn, plans that break the rules, and people without a seat", () => {
    const room = lobby();
    join(room, "friend", "Ali");
    start(room, "host");
    expect(() => submit(room, "host", 2, {})).toThrow("another turn");
    expect(() => submit(room, "host", 1, { steps: { nowhere: 3 } })).toThrow("breaks the rules");
    expect(() => submit(room, "stranger", 1, {})).toThrow("seat");
  });

  it("plays to the end, and every device replaying the sent turns lands on the server's board and result", () => {
    const room = lobby();
    join(room, "friend", "Ali");
    start(room, "host");
    const pack = packFor(room.setup);
    // A device starts from the same board and replays each turn it is sent.
    let device: GameState = createMatch(pack, { seed: 4242, players: room.state!.players.map((p) => ({ id: p.id, leaderId: p.leaderId, party: p.party })) });
    let finished = false;
    for (let guard = 0; guard < 60 && !finished; guard++) {
      const turn = room.state!.turn;
      submit(room, "host", turn, planFor(room, "p1"));
      const out = submit(room, "friend", turn, planFor(room, "p2"));
      for (const t of out.turns) device = playTurn(pack, device, t.plans, t.rng).next;
      finished = out.finished;
      expect(device).toEqual(room.state);
    }
    expect(finished).toBe(true);
    expect(room.status).toBe("finished");
    expect(room.result!.ranking).toHaveLength(3);
    expect(() => submit(room, "host", room.state!.turn, {})).toThrow("isn't being played");
  });
});

describe("turn timers", () => {
  const timed = (seconds: number) => {
    const room = newRoom("TIME01", "match-2", { ...structuredClone(SETUP), turnSeconds: seconds }, HOST, 99, 0);
    join(room, "friend", "Ali");
    start(room, "host", 1000);
    return room;
  };

  it("only offers the listed timers", () => {
    expect(() => checkSetup({ ...SETUP, turnSeconds: 7 })).toThrow("timer");
    expect(() => checkSetup({ ...SETUP, turnSeconds: 3600 })).not.toThrow();
    expect(() => checkSetup({ ...SETUP, turnSeconds: null })).not.toThrow();
  });

  it("sets a deadline each turn, and does nothing before it", () => {
    const room = timed(60);
    expect(room.deadline).toBe(61_000);
    expect(timeout(room, 60_999).turns).toEqual([]);
    submit(room, "host", 1, {}, 2000);
    submit(room, "friend", 1, {}, 3000);
    expect(room.deadline).toBe(63_000); // the next turn's clock starts when the last plan arrives
  });

  it("resolves the turn when time runs out; whoever missed it campaigns with nothing new", () => {
    const room = timed(60);
    const plan = planFor(room, "p1");
    submit(room, "host", 1, plan, 2000);
    expect(waitingOn(room)).toEqual(["p2"]);
    const out = timeout(room, 61_000);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0]!.plans.p2).toEqual({});
    expect(out.turns[0]!.plans.p1).toEqual(plan);
    expect(room.missed).toMatchObject({ p2: 1 });
    expect(room.state!.turn).toBe(2);
  });

  it("hands a seat to the computer after three missed turns in a row, until its person sends a plan again", () => {
    const room = timed(60);
    let clock = 1000;
    for (let i = 0; i < 3; i++) {
      submit(room, "host", room.state!.turn, {}, clock);
      clock = room.deadline!;
      timeout(room, clock);
    }
    expect(room.autopilot).toEqual(["p2"]);
    // The third missed turn was already played by the computer.
    expect(Object.keys(room.log[2]!.plans.p2!).length).toBeGreaterThan(0);
    // On autopilot the friend isn't waited for: the host's plan resolves the turn.
    expect(waitingOn(room)).toEqual(["p1"]);
    expect(submit(room, "host", room.state!.turn, {}, clock).turns).toHaveLength(1);
    // Back from a break: one plan and the seat is theirs again.
    submit(room, "friend", room.state!.turn, {}, clock);
    expect(room.autopilot).toEqual([]);
    expect(room.missed.p2).toBe(0);
  });

  it("waits for the clock, not for nobody, when every person is on autopilot", () => {
    const room = timed(60);
    room.autopilot = ["p1", "p2"];
    expect(waitingOn(room)).toEqual([]);
    expect(timeout(room, room.deadline! - 1).turns).toEqual([]);
    expect(timeout(room, room.deadline!).turns).toHaveLength(1);
  });

  it("has no deadline without a timer", () => {
    const room = lobby();
    join(room, "friend", "Ali");
    start(room, "host", 1000);
    expect(room.deadline).toBeNull();
    expect(timeout(room, 10 ** 13).turns).toEqual([]);
  });
});
