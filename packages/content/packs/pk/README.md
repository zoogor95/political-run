# Pakistan pack

Draft numbers for tuning. Parties, leaders and the map still need the Pakistani legal review (roadmap M2.2) before release.

## Seats

- **General seats (266):** the Election Commission of Pakistan's 2023 delimitation, used for the February 2024 general election: Punjab 141, Sindh 61, Khyber Pakhtunkhwa 45, Balochistan 16, Islamabad 3. The constituency list (NA-1 to NA-266) is in `packages/mapbuild/src/pakistan-seats.ts`, taken from Wikipedia's "List of constituencies of Pakistan".
- **Regions:** Pakistan's 33 divisions: Punjab 10 (including Gujrat division, made in 2022), Sindh 7, Khyber Pakhtunkhwa 7, Balochistan 8, and Islamabad. Each division holds the constituencies of its districts; the map build checks that no shared constituency crosses a division. Districts created since the boundary file was drawn count in the district that held them, for example Chiniot in Jhang and Hub in Lasbela. The division table is in `packages/mapbuild/src/pakistan-seats.ts`.
- **Reserved seats (70):** the 60 women's seats (Punjab 32, Sindh 14, Khyber Pakhtunkhwa 10, Balochistan 4) are shared by general seats won in each province. The 10 non-Muslim seats are shared nationwide. Both use the largest remainder. In real elections independents and party lists complicate this; in the game every seat-winner is a party.
- **Total:** 336 seats, 169 for a majority.
- **Not in play:** Gilgit-Baltistan and Azad Jammu and Kashmir have no National Assembly seats. They are drawn grey.

## Voters

The popular vote uses the Election Commission's 2024 registered voters by province: Punjab 73,207,896; Sindh 26,994,769; Khyber Pakhtunkhwa 21,928,119; Balochistan 5,371,947; Islamabad 1,083,029. Each province's voters are spread across its regions by seats. These are estimates, not district rolls.

## Money

Amounts are in rupees: base income Rs 25M a turn. A division's first step costs Rs 300K plus Rs 78K per seat. Group incomes and national group costs are drafts, tuned with the balance simulator; the report is in `docs/balance/pk.md`.
