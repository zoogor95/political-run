/**
 * How source boundaries map to game regions, with seat counts.
 * UK, India and Malaysia use real seat counts; US uses 2024 electoral votes; Pakistan's district seats are sample values (see pakistan.ts).
 */

/** Natural Earth "region" name -> [id, game name, seats]. Several source areas can form one game region. */
export const UK: Record<string, [string, string, number]> = {
  "Northern Ireland": ["ni", "Northern Ireland", 18],
  "West Wales and the Valleys": ["wal", "Wales", 32],
  "East Wales": ["wal", "Wales", 32],
  Eastern: ["sco", "Scotland", 57],
  "South Western": ["sco", "Scotland", 57],
  "Highlands and Islands": ["sco", "Scotland", 57],
  "North Eastern": ["sco", "Scotland", 57],
  "North West": ["nw", "North West", 73],
  "West Midlands": ["wm", "West Midlands", 57],
  "South West": ["sw", "South West", 58],
  "North East": ["ne", "North East", 27],
  "Yorkshire and the Humber": ["yh", "Yorkshire and the Humber", 54],
  "East Midlands": ["em", "East Midlands", 47],
  East: ["ee", "East of England", 61],
  "South East": ["se", "South East", 91],
  "Greater London": ["lon", "London", 75],
};

/** Natural Earth state name -> [id, Lok Sabha seats]. */
export const INDIA: Record<string, [string, number]> = {
  "Uttar Pradesh": ["up", 80], Maharashtra: ["mh", 48], "West Bengal": ["wb", 42], Bihar: ["br", 40], "Tamil Nadu": ["tn", 39],
  "Madhya Pradesh": ["mp", 29], Karnataka: ["ka", 28], Gujarat: ["gj", 26], "Andhra Pradesh": ["ap", 25], Rajasthan: ["rj", 25],
  Odisha: ["od", 21], Kerala: ["kl", 20], Telangana: ["tg", 17], Assam: ["as", 14], Jharkhand: ["jh", 14], Punjab: ["pb", 13],
  Chhattisgarh: ["cg", 11], Haryana: ["hr", 10], Delhi: ["dl", 7], "Jammu and Kashmir": ["jk", 5], Uttarakhand: ["ut", 5],
  "Himachal Pradesh": ["hp", 4], "Arunachal Pradesh": ["ar", 2], Goa: ["ga", 2], Manipur: ["mn", 2], Meghalaya: ["ml", 2],
  Tripura: ["tr", 2], Mizoram: ["mz", 1], Nagaland: ["nl", 1], Sikkim: ["sk", 1], "Andaman and Nicobar": ["an", 1],
  Chandigarh: ["ch", 1], "Dadra and Nagar Haveli and Daman and Diu": ["dd", 2], Ladakh: ["la", 1], Lakshadweep: ["ld", 1],
  Puducherry: ["py", 1],
};

/** Natural Earth state name -> [id, Dewan Rakyat seats]. */
export const MALAYSIA: Record<string, [string, number]> = {
  Perlis: ["pls", 3], Kedah: ["kdh", 15], Kelantan: ["ktn", 14], Terengganu: ["trg", 8], "Pulau Pinang": ["png", 13],
  Perak: ["prk", 24], Pahang: ["phg", 14], Selangor: ["sgr", 22], "Negeri Sembilan": ["nsn", 8], Melaka: ["mlk", 6],
  Johor: ["jhr", 26], Sabah: ["sbh", 25], Sarawak: ["swk", 31], "Kuala Lumpur": ["kul", 11], Putrajaya: ["pjy", 1], Labuan: ["lbn", 1],
};
/** East Malaysia is moved closer to the peninsula (a layout inset) so the regions can be drawn bigger. */
export const MALAYSIA_EAST = ["sbh", "swk", "lbn"];

/** us-atlas FIPS code -> [id, name, 2024 electoral votes]. Maine and Nebraska are played whole. */
export const US: Record<string, [string, string, number]> = {
  "01": ["al", "Alabama", 9], "02": ["ak", "Alaska", 3], "04": ["az", "Arizona", 11], "05": ["ar", "Arkansas", 6],
  "06": ["ca", "California", 54], "08": ["co", "Colorado", 10], "09": ["ct", "Connecticut", 7], "10": ["de", "Delaware", 3],
  "11": ["dc", "District of Columbia", 3], "12": ["fl", "Florida", 30], "13": ["ga", "Georgia", 16], "15": ["hi", "Hawaii", 4],
  "16": ["id", "Idaho", 4], "17": ["il", "Illinois", 19], "18": ["in", "Indiana", 11], "19": ["ia", "Iowa", 6],
  "20": ["ks", "Kansas", 6], "21": ["ky", "Kentucky", 8], "22": ["la", "Louisiana", 8], "23": ["me", "Maine", 4],
  "24": ["md", "Maryland", 10], "25": ["ma", "Massachusetts", 11], "26": ["mi", "Michigan", 15], "27": ["mn", "Minnesota", 10],
  "28": ["ms", "Mississippi", 6], "29": ["mo", "Missouri", 10], "30": ["mt", "Montana", 4], "31": ["ne", "Nebraska", 5],
  "32": ["nv", "Nevada", 6], "33": ["nh", "New Hampshire", 4], "34": ["nj", "New Jersey", 14], "35": ["nm", "New Mexico", 5],
  "36": ["ny", "New York", 28], "37": ["nc", "North Carolina", 16], "38": ["nd", "North Dakota", 3], "39": ["oh", "Ohio", 17],
  "40": ["ok", "Oklahoma", 7], "41": ["or", "Oregon", 8], "42": ["pa", "Pennsylvania", 19], "44": ["ri", "Rhode Island", 4],
  "45": ["sc", "South Carolina", 9], "46": ["sd", "South Dakota", 3], "47": ["tn", "Tennessee", 11], "48": ["tx", "Texas", 40],
  "49": ["ut", "Utah", 6], "50": ["vt", "Vermont", 3], "51": ["va", "Virginia", 13], "53": ["wa", "Washington", 12],
  "54": ["wv", "West Virginia", 4], "55": ["wi", "Wisconsin", 10], "56": ["wy", "Wyoming", 3],
};

/** Expected totals, checked after every build. */
export const EXPECTED_SEATS: Record<string, number> = { uk: 650, in: 543, pk: 266, my: 222, us: 538 };
