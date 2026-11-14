import { describe, expect, it } from "vitest";
import { HEADLINE_KINDS, PLACEHOLDERS, fillTemplate, type NewsTemplates } from "@majority-map/core";
import pkNews from "../news/pk.json" with { type: "json" };
import ukNews from "../news/uk.json" with { type: "json" };
import usNews from "../news/us.json" with { type: "json" };

/** Words the humour rules keep off the ticker: no alcohol, gambling, innuendo or crude language. */
const BANNED = /\b(beer|wine|pub|pubs|pint|pints|drunk|booze|bar|bars|vodka|whisky|gin|cocktail|bet|bets|betting|bookies|odds|casino|gamble|gambling|lottery|sexy|sex|damn|hell|crap|stupid|idiot)\b/i;

const PACKS: [string, NewsTemplates][] = [
  ["UK", ukNews as NewsTemplates],
  ["Pakistan", pkNews as NewsTemplates],
  ["US", usNews as NewsTemplates],
];

for (const [name, news] of PACKS) {
  const all = HEADLINE_KINDS.flatMap((k) => news.templates[k].map((t) => ({ kind: k, t })));

  describe(`${name} news templates`, () => {
    it("has at least 150 headlines and some for every kind", () => {
      expect(all.length).toBeGreaterThanOrEqual(150);
      for (const k of HEADLINE_KINDS) expect(news.templates[k].length, k).toBeGreaterThanOrEqual(4);
    });

    it("uses only the blanks each kind allows", () => {
      for (const { kind, t } of all) {
        const vars = Object.fromEntries(PLACEHOLDERS[kind].map((p) => [p, "X"]));
        expect(() => fillTemplate(t, kind, vars)).not.toThrow();
      }
    });

    it("has no duplicates and fits on the ticker", () => {
      expect(new Set(all.map((x) => x.t.toLowerCase())).size).toBe(all.length);
      for (const { t } of all) expect(t.length, t).toBeLessThanOrEqual(110);
    });

    it("reads well with any number of rivals", () => {
      // {rivals} may already be "A and B", so "{you} and {rivals}" would read "X and A and B".
      for (const t of news.templates.conflict_you) expect(t, t).not.toMatch(/\{you\} and \{rivals\}|\{rivals\} and \{you\}/);
    });

    it("keeps to the humour rules: clean language, no alcohol or gambling", () => {
      expect(all.filter(({ t }) => BANNED.test(t)).map(({ t }) => t)).toEqual([]);
    });
  });
}
