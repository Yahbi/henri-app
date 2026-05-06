// Smoke test the probe heuristic against 6 known cases.
// Uses node 24's experimental-strip-types to load the TS source directly.
import { probeSource } from "../src/lib/sources/probe.ts";

const cases = [
  { label: "Chicago Socrata",            type: "socrata", ep: "https://data.cityofchicago.org/resource/ydr8-5enu.json", name: "Building Permits",            expect: (r) => r.ok && r.reachable },
  { label: "Wilson AGOL hub landing",    type: "arcgis",  ep: "https://wilson.maps.arcgis.com",                          name: "landing",                      expect: (r) => !r.ok && (r.error ?? "").includes("platform-unprobeable") },
  { label: "NOLA Code Enforcement",      type: "socrata", ep: "https://data.nola.gov/resource/6ha4-bwyc.json",           name: "Code Enforcement All Cases",   expect: (r) => r.ok === true },
  { label: "Hartford CKAN (live)",       type: "ckan",    ep: "https://data.hartford.gov/dataset/building-permits",       name: "hartford",                     expect: (r) => true }, // live, just report
  { label: "Fake CSV host",              type: "csv",     ep: "https://raw.githubusercontent.com/example/permits.csv",    name: "test",                         expect: (r) => !r.ok },
  { label: "Unknown source type",        type: "unknown", ep: "http://example.com",                                       name: "unsupported",                  expect: (r) => !r.ok && /no probe implemented/i.test(r.error ?? "") },
];

for (const c of cases) {
  try {
    const r = await probeSource(c.type, c.ep, c.name);
    const pass = c.expect(r);
    const tag = pass ? "OK " : "NO ";
    const detail = r.ok
      ? `ok=true reachable=${r.reachable}`
      : `ok=false err="${(r.error ?? "").slice(0, 60)}"`;
    console.log(`[${tag}] ${c.label.padEnd(30)} ${detail}`);
  } catch (e) {
    console.log(`[ERR] ${c.label.padEnd(30)} threw: ${(e?.message ?? e).toString().slice(0, 80)}`);
  }
}
