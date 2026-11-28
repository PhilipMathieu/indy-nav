import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocation } from "./parse-location";

// Real location lines from indyskipass.com resort cards (Nov 2026).
const cases: [string, string, string][] = [
  ["Chewelah, WA, USA", "WA", "USA"],
  ["Bethel, ME", "ME", "USA"],
  ["Camden, Maine", "ME", "USA"],
  ["Kimberly, Idaho", "ID", "USA"],
  ["Palmer, Alaska", "AK", "USA"],
  ["Neihart MT", "MT", "USA"],
  ["Scranton PA, PA, USA", "PA", "USA"],
  ["Bear Valley, CA", "CA", "USA"],
  ["Norden, Lake Tahoe, CA", "CA", "USA"],
  ["Norway, MI", "MI", "USA"],
  ["447 Ski Resort Rd, Greenville Junction, ME 04442", "ME", "USA"],
  ["4323 VT RT 108 SOUTH, JEFFERSONVILLE, VT 05464", "VT", "USA"],
  ["Penticton, BC, CA", "BC", "Canada"],
  ["Chelsea, Quebec, Canada", "QC", "Canada"],
  ["Val-David, Québec", "QC", "Canada"],
  ["Riquad QC, Canada", "QC", "Canada"],
  ["NL, Canada", "NL", "Canada"],
  ["Whitehorse, Yukon, Canada", "YT", "Canada"],
  ["Morioka City, Iwate Prefecture, Japan", "Iwate", "Japan"],
  ["Joetsu, Niigata 942-0534, Japan", "Niigata", "Japan"],
  ["Tone-gun, Gunma", "Gunma", "Japan"],
  ["Yubari, Hokkaido", "Hokkaido", "Japan"],
  ["Gunma, Agatsuma District, Tsumagoi, Japan", "Gunma", "Japan"],
  ["Niigata, Shibata, Kamisanko, 大平国有林無番地", "Niigata", "Japan"],
  ["Tazawako, Tohoku", "Tohoku", "Japan"],
  ["Narukoonsen Onikobe, Osaki Japan", "Japan", "Japan"],
  ["Liftweg 2, 5661 Rauris, Austria", "Austria", "Austria"],
  ["St. Johann in Tirol,  Austria", "Austria", "Austria"],
  ["Aberdeenshire, Scotland , AB35 5XU", "Scotland", "Scotland"],
  ["Reserva Nacional Malalcahuello S/N, Curacautin, Chile", "Chile", "Chile"],
  ["French Swiss Border", "", ""],
  ["", "", ""],
];

for (const [input, state, country] of cases) {
  test(JSON.stringify(input), () => {
    assert.deepEqual(parseLocation(input), { state, country });
  });
}
