# US map pack (draft)

**First balance pass (M3.4) done; see "Balance" below for what still fails.**

- **Game type:** Presidential. Each state's electoral votes go to its leader; 270 of 538 wins. Without a majority, the candidate with the fewest electoral votes is eliminated and the campaign goes on.
- **Regions:** the 50 states and DC with the 2024 electoral votes (2020-census apportionment). Maine and Nebraska are played as whole states.
- **Voters:** each state's total ballots for president in 2024 (`results-2024.json`, from Wikipedia's results-by-state table, compiled from certified state results). Used only for the popular vote on election night.
- **Step costs:** flat (every step costs the same), growing a little faster than electoral votes and higher in close states:
  `baseCost = $1,400 × EV^1.1 × competitiveness`, to the nearest $1K and at least $3K, where
  `competitiveness = 1 + 0.6 × max(0, 1 − margin / 25)` and `margin` is the 2024 gap between the Republican and Democratic shares in points.
  Big states cost a little more per electoral vote, so a big-state-only campaign isn't a bargain. California is $126K a step, Pennsylvania $56K, Wyoming $5K.
- **Income:** $250K base money every turn (also the starting money), plus each group you control.
- **State groups (9):** our own sets of states from regional, economic and demographic data: New England, Mid-Atlantic, Rust Belt, Old South, Sun Belt, Farm Belt, Mountain West, Pacific Coast and Energy Belt. Every state is in at least one; some (Pennsylvania, Georgia, Arizona, Nevada, Texas, Louisiana, North Dakota, Wyoming, Alaska, New Mexico) are in two. Income: $20K + $400 per electoral vote in the group.
- **National groups (6):** Labor unions, Small business, Seniors, Young voters, Veterans and Faith voters. Each has its own 10-step meter at $70K a step (above most states) and pays $40K to $50K.
- **Computer players:** on this map they value group control more (`aiTuning`: group value 2.5x, so taking the lead in a state counts for its groups too); Hard expects fewer rivals to climb than on the UK and plays with more randomness (noise 0.9), which makes it clearly harder than Normal.
- **Custom candidates:** a budget of 5 points (8 on the UK). The price formula undercharges three groups here, so the pack sets them: Mountain West 2, Energy Belt 3, Old South 3 points per 5%. A 5% penalty gives back a quarter of the group's price (half elsewhere): on a winner-takes-all map, a penalty in states you never contest costs you almost nothing, so it shouldn't buy much.
- **Candidates:** 17 real politicians, living and historical: Republican, Democratic and Independent. Modifiers come from public record (home states, offices held, past results and exit polls), never opinion; the `notes` field gives the reason shown on the candidate card. Living candidates need the same legal review as the Pakistan pack before release.
- **Running mate:** picked on turn 5 from every candidate except yourself and your opponents' candidates; adds 20% of their bonuses and penalties.
- **Election night call order:** east to west by poll-closing time (Eastern time): 7pm GA, IN, KY, SC, VT, VA; 7:30 NC, OH, WV; 8pm AL, CT, DE, DC, FL, IL, ME, MD, MA, MS, MO, NH, NJ, OK, PA, RI, TN; 8:30 AR; 9pm AZ, CO, KS, LA, MI, MN, NE, NM, NY, ND, SD, TX, WI, WY; 10pm IA, MT, NV, UT; 11pm CA, ID, OR, WA; midnight HI; 1am AK.

## Balance (4,000 matches; full report in docs/balance/us.md)

| | First draft | Now |
| --- | ---: | ---: |
| Match length | 23 turns | 16.6 turns |
| Matches hitting the 40-turn cap | 37% | 0% |
| Matches with an elimination | 29% | 28% |
| Hard vs two Normals (33% is even) | 35% | 39% |
| Leaders outside the band | Trump, Kennedy | none |
| Spending lost to clashes | 46% | 28% |

Still failing:

- **Balanced wins 69% of its duels** (the limit is 60%). It is level with Groups and income (51%) and wins mostly against Rush and Hoard, which are weak ways to play this map. The computer players' own all-round play comes out best rather than one narrow trick, but the gate is the gate.
- **Big regions wins 2.7x its share in free-for-alls** (not a gate: the limit is on duels), while it loses most duels.
