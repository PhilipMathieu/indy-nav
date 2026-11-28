/**
 * Turns the free-form location line on an indyskipass.com resort card into a
 * short place label (`state`) and a country.
 *
 * The cards are hand-entered and inconsistent, for example:
 *   "Chewelah, WA, USA"            "Camden, Maine"
 *   "Penticton, BC, CA"            "Bear Valley, CA"           (California)
 *   "Neihart MT"                   "Riquad QC, Canada"
 *   "447 Ski Resort Rd, Greenville Junction, ME 04442"
 *   "Joetsu, Niigata 942-0534, Japan"
 *   "Aberdeenshire, Scotland , AB35 5XU"
 *   "Niigata, Shibata, Kamisanko, 大平国有林無番地"
 *
 * Rather than trusting the position of each comma-separated part, every part
 * (and the last word of each part) is matched against known names, right to
 * left. Street addresses and postal codes never match, so they drop out.
 *
 * `state` is the US state or Canadian province code, the Japanese prefecture,
 * or the country for everywhere else.
 */

export interface ParsedLocation {
  /** "ME", "QC", "Niigata", "Austria", ... or "" when nothing was recognized. */
  state: string;
  /** ISO-ish country name: "USA", "Canada", "Japan", "Austria", ... or "". */
  country: string;
}

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
};

const JP_PREFECTURES = [
  "Hokkaido", "Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima",
  "Ibaraki", "Tochigi", "Gunma", "Saitama", "Chiba", "Tokyo", "Kanagawa",
  "Niigata", "Toyama", "Ishikawa", "Fukui", "Yamanashi", "Nagano", "Gifu",
  "Shizuoka", "Aichi", "Mie", "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara",
  "Wakayama", "Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi",
  "Tokushima", "Kagawa", "Ehime", "Kochi", "Fukuoka", "Saga", "Nagasaki",
  "Kumamoto", "Oita", "Miyazaki", "Kagoshima", "Okinawa",
];
/** Japanese regions used on some cards in place of a prefecture. */
const JP_REGIONS = ["Tohoku", "Kanto", "Chubu", "Kansai", "Chugoku", "Shikoku", "Kyushu"];

/** Countries outside the US, Canada and Japan, keyed by lowercased alias. */
const OTHER_COUNTRIES: Record<string, string> = {
  austria: "Austria", czechia: "Czechia", "czech republic": "Czechia",
  finland: "Finland", france: "France", germany: "Germany", italy: "Italy",
  norway: "Norway", scotland: "Scotland", slovenia: "Slovenia", spain: "Spain",
  sweden: "Sweden", switzerland: "Switzerland", andorra: "Andorra",
  chile: "Chile", argentina: "Argentina", "new zealand": "New Zealand",
};

/** Strip accents and lowercase, so "Québec" matches "quebec". */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const byName = new Map<string, ParsedLocation>();
for (const [code, name] of Object.entries(US_STATES)) {
  byName.set(norm(name), { state: code, country: "USA" });
}
for (const [code, name] of Object.entries(CA_PROVINCES)) {
  byName.set(norm(name), { state: code, country: "Canada" });
}
for (const p of [...JP_PREFECTURES, ...JP_REGIONS]) {
  byName.set(norm(p), { state: p, country: "Japan" });
  byName.set(norm(`${p} Prefecture`), { state: p, country: "Japan" });
}
byName.set("japan", { state: "Japan", country: "Japan" });
for (const [alias, name] of Object.entries(OTHER_COUNTRIES)) {
  byName.set(alias, { state: name, country: name });
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "USA", us: "USA", "united states": "USA",
  canada: "Canada", japan: "Japan",
  ...OTHER_COUNTRIES,
};

/** Remove postal codes: US ZIP, Japanese 〒, UK postcode, leading European code. */
function stripPostal(part: string): string {
  return part
    .replace(/\b\d{5}(-\d{4})?\b/g, "")
    .replace(/\b\d{3}-\d{4}\b/g, "")
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match one token: a state/province code, or a state, province, prefecture or country name. */
function matchToken(token: string): ParsedLocation | null {
  const upper = token.toUpperCase();
  if (token.length === 2 && token === upper) {
    if (US_STATES[upper]) return { state: upper, country: "USA" };
    if (CA_PROVINCES[upper]) return { state: upper, country: "Canada" };
  }
  return byName.get(norm(token)) ?? null;
}

export function parseLocation(location: string | null | undefined): ParsedLocation {
  if (!location) return { state: "", country: "" };

  const parts = location
    .split(",")
    .map(stripPostal)
    .filter(Boolean);

  // Trailing country, if the card has one. "CA" after a province means Canada.
  let country = "";
  const last = parts[parts.length - 1];
  if (last) {
    const alias = COUNTRY_ALIASES[norm(last)];
    const prev = parts[parts.length - 2];
    if (last === "CA" && prev && CA_PROVINCES[prev.toUpperCase()]) {
      country = "Canada";
      parts.pop();
    } else if (alias) {
      country = alias;
      parts.pop();
    }
  }

  // Right to left: whole part first, then its last word ("Neihart MT",
  // "Riquad QC", "Osaki Japan").
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const words = part.split(" ");
    const candidates = [part, words[words.length - 1]];
    for (const c of candidates) {
      const hit = matchToken(c);
      // A country named on the card wins over a token that disagrees with it.
      if (hit && (!country || hit.country === country)) return hit;
    }
  }

  if (country === "USA" || country === "Canada") return { state: "", country };
  return { state: country, country };
}
