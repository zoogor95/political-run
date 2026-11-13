# US map pack (draft)

**Every number here is a draft value for the Presidential balance pass (M3.4), not final balance.**

- **Game type:** Presidential. Each state's electoral votes go to its leader; 270 of 538 wins. Without a majority, the candidate with the fewest electoral votes is eliminated and the campaign goes on.
- **Regions:** the 50 states and DC with the 2024 electoral votes (2020-census apportionment). Maine and Nebraska are played as whole states.
- **Voters:** each state's total ballots for president in 2024 (`results-2024.json`, from Wikipedia's results-by-state table, compiled from certified state results). Used only for the popular vote on election night.
- **Step costs:** flat (every step costs the same), built from electoral votes and how close the state was in 2024:
  `baseCost = $2,000 + $1,500 × electoral votes × competitiveness`, to the nearest $1K, where
  `competitiveness = 1 + 0.6 × max(0, 1 − margin / 25)` and `margin` is the 2024 gap between the Republican and Democratic shares in points.
  A dead-even state costs 1.6x a safe one of the same size. California is $92K a step; Pennsylvania $46K; Wyoming $7K.
- **Income:** $250K base money every turn (also the starting money), plus each group you control.
- **State groups (9):** our own sets of states from regional, economic and demographic data: New England, Mid-Atlantic, Rust Belt, Old South, Sun Belt, Farm Belt, Mountain West, Pacific Coast and Energy Belt. Every state is in at least one; some (Pennsylvania, Georgia, Arizona, Nevada, Texas, Louisiana, North Dakota, Wyoming, Alaska, New Mexico) are in two. Income: $20K + $400 per electoral vote in the group.
- **National groups (6):** Labor unions, Small business, Seniors, Young voters, Veterans and Faith voters. Each has its own 10-step meter at $70K a step (above most states) and pays $40K to $50K.
- **Candidates:** 17 real politicians, living and historical: Republican, Democratic and Independent. Modifiers come from public record (home states, offices held, past results and exit polls), never opinion; the `notes` field gives the reason shown on the candidate card. Living candidates need the same legal review as the Pakistan pack before release.
- **Running mate:** picked on turn 5 from every candidate except yourself and your opponents' candidates; adds 20% of their bonuses and penalties.
- **Election night call order:** east to west by poll-closing time (Eastern time): 7pm GA, IN, KY, SC, VT, VA; 7:30 NC, OH, WV; 8pm AL, CT, DE, DC, FL, IL, ME, MD, MA, MS, MO, NH, NJ, OK, PA, RI, TN; 8:30 AR; 9pm AZ, CO, KS, LA, MI, MN, NE, NM, NY, ND, SD, TX, WI, WY; 10pm IA, MT, NV, UT; 11pm CA, ID, OR, WA; midnight HI; 1am AK.

## First simulation (2,000 matches, before any tuning)

The rules work end to end, but the pack needs the balance pass:

- Matches are long: 23 turns on average, and 37% reach the 40-turn safety cap, mostly four- and five-player matches with several eliminations (every elimination takes pips off the map, so regions fall out of contention again).
- The Big regions strategy wins 74% of its duels (the limit is 60%).
- Donald Trump (1.34x) and John F. Kennedy (0.75x) are outside the leader band.
