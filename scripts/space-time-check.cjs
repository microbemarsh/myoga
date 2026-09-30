// Run with: node scripts/space-time-check.cjs
const assert = require("node:assert/strict");
const core = require("../src/space-time.js");
const {
  day,
  visibility,
  thresholdEdges,
  prepareObservations,
  timeTicks,
  colorFor,
  validateSettings,
} = core;

assert.equal(colorFor("lineage A"), colorFor("lineage A"));
assert.equal(colorFor("lineage A"), "#22a06d"); // pinned, independent of category order
assert.equal(core.escapeHTML('<script>"&'), "&lt;script&gt;&quot;&amp;");
const raw = [
  {
    id: "A",
    latitude: 40,
    longitude: 179,
    start: "2021-01-01",
    end: "2021-12-31",
    metadata: { cluster: "one" },
  },
  {
    id: "B",
    latitude: 40,
    longitude: -179,
    start: "2024-01-01",
    end: "2024-01-01",
    metadata: { cluster: "two" },
  },
  {
    id: "C",
    latitude: 40,
    longitude: 179,
    start: "2021-06-01",
    end: "2021-06-01",
    metadata: { cluster: "one" },
  },
];
const model = prepareObservations(raw),
  obs = model.obs;
assert.ok(model.xr[1] - model.xr[0] < 3, "dateline must not span the world");
assert.equal(obs[0].longitude, 179, "true coordinates are preserved");
assert.notEqual(obs[0].dx, obs[2].dx, "repeated sites separate");
assert.equal(prepareObservations(raw).obs[0].dx, obs[0].dx);
const local = prepareObservations([
  { ...raw[0], longitude: -71, latitude: 42 },
  { ...raw[1], longitude: -70.99999, latitude: 42.00001 },
]);
assert.ok(local.xr[1] - local.xr[0] < 0.0001, "meter-scale sites remain local");
const transect = prepareObservations([
  { ...raw[0], longitude: -75, latitude: 42 },
  { ...raw[1], longitude: -65, latitude: 42 },
]);
assert.ok(
  transect.yr[1] - transect.yr[0] > 1,
  "pad narrow geographic ranges instead of distorting units",
);
let state = {
  filters: {},
  isolate: null,
  color: "cluster",
  full: false,
  window: 30,
  history: "window",
};
assert.equal(
  visibility(obs[0], state, day("2021-06-01")),
  1,
  "interval overlap, not midpoint",
);
assert.equal(
  visibility(obs[1], state, day("2021-06-01")),
  0,
  "future interval hidden",
);
assert.equal(visibility(obs[0], state, day("2024-06-01")), 0);
state.history = "fade";
assert.equal(visibility(obs[0], state, day("2024-06-01")), 0.15);
state.full = true;
assert.equal(visibility(obs[1], state, day("2021-06-01")), 1);
state.filters = { cluster: "one" };
assert.equal(visibility(obs[1], state, 0), 0);
state.filters = {};
state.isolate = "two";
assert.equal(visibility(obs[0], state, 0), 0);
const edges = [
  { a: 0, b: 1, distance: 0 },
  { a: 0, b: 2, distance: 2 },
  { a: 1, b: 2, distance: 8 },
];
assert.equal(thresholdEdges(edges, 2, [1, 1, 1]).length, 2);
assert.equal(thresholdEdges(edges, 2, [1, 0, 1]).length, 1);
assert.equal(thresholdEdges(edges, 0, [1, 1, 1]).length, 1);
for (const scale of ["linear", "year", "month", "day"]) {
  const ticks = timeTicks(day("1900-01-01"), day("2026-12-31"), scale);
  assert.ok(ticks.tickvals.length <= 8);
  assert.ok(ticks.ticktext.every((t) => /^\d{4}(-\d{2}){0,2}$/.test(t)));
}
assert.equal(
  timeTicks(day("2024-01-01"), day("2024-01-01"), "linear").tickvals.length,
  1,
);
const full = {
  color: "cluster",
  tooltip: "cluster",
  filters: { cluster: "one" },
  isolate: null,
  full: true,
  cursor: 1000,
  window: 30,
  speed: 1,
  height: 1.2,
  timeScale: "year",
  history: "retain",
  connections: "none",
  threshold: 2,
  basemap: true,
  uncertainty: true,
  jitter: true,
  edgeOpacity: true,
  exportWidth: 2400,
  exportHeight: 1600,
  background: "white",
  camera: {
    eye: { x: 1, y: 1, z: 1 },
    up: { x: 0, y: 0, z: 1 },
    center: { x: 0, y: 0, z: 0 },
  },
};
const settings = { version: 1, fingerprint: "abc", state: full };
assert.deepEqual(
  validateSettings(settings, { fingerprint: "abc", distanceMax: 8 }, [
    "cluster",
  ]),
  full,
);
assert.throws(() =>
  validateSettings(settings, { fingerprint: "other", distanceMax: 8 }, [
    "cluster",
  ]),
);
assert.throws(() =>
  validateSettings(
    { ...settings, state: { ...full, height: NaN } },
    { fingerprint: "abc", distanceMax: 8 },
    ["cluster"],
  ),
);
assert.throws(() =>
  validateSettings(
    { ...settings, state: { ...full, camera: { eye: { x: "bad" } } } },
    { fingerprint: "abc", distanceMax: 8 },
    ["cluster"],
  ),
);
const communityData = {
  fingerprint: "community",
  distanceMax: 0,
  observations: raw,
  community: {
    rank: "G",
    threshold: 1,
    profiles: [
      {
        sample: 0,
        total: 1000,
        unclassified: 100,
        taxa: [
          {
            taxid: "5",
            name: "Example genus",
            clade: 600,
            direct: 50,
            percent: 60,
          },
          { taxid: "6", name: "Rare genus", clade: 1, direct: 1, percent: 0.1 },
          { taxid: "7", name: "Zero genus", clade: 0, direct: 0, percent: 0 },
        ],
      },
    ],
  },
};
const taxonObservations = core.communityObservations(communityData);
assert.equal(
  taxonObservations.length,
  2,
  "zero-count rows stay in profiles, not detection points",
);
assert.equal(taxonObservations[0].metadata.kraken_sample_id, "A");
assert.equal(taxonObservations[0].metadata.kraken_clade_fragments, "600");
assert.equal(taxonObservations[0].latitude, raw[0].latitude);
assert.equal(
  raw[0].metadata.kraken_taxon,
  undefined,
  "original metadata must remain unchanged",
);
const communityModel = prepareObservations(taxonObservations, raw);
assert.equal(
  communityModel.max,
  day("2024-01-01"),
  "missing reports still contribute sample/date context",
);
const communityState = {
  ...full,
  threshold: 0,
  color: "kraken_taxon",
  filters: {},
  isolate: null,
  abundanceThreshold: 1,
  abundanceSize: true,
};
assert.equal(visibility(communityModel.obs[0], communityState, 0), 1);
assert.equal(visibility(communityModel.obs[1], communityState, 0), 0);
assert.equal(
  visibility(
    communityModel.obs[1],
    { ...communityState, abundanceThreshold: 0.1 },
    0,
  ),
  1,
  "threshold equality is included",
);
assert.equal(
  visibility(
    communityModel.obs[0],
    { ...communityState, abundanceThreshold: 100 },
    0,
  ),
  0,
);
assert.equal(
  prepareObservations([], raw).obs.length,
  0,
  "an all-unclassified dataset must retain geographic context",
);
assert.ok(Number.isFinite(prepareObservations([], raw).min));
const communitySettings = {
  version: 1,
  fingerprint: "community",
  state: communityState,
};
assert.deepEqual(
  validateSettings(communitySettings, communityData, [
    "cluster",
    "kraken_taxon",
  ]),
  communityState,
);
for (const patch of [
  { abundanceThreshold: NaN },
  { abundanceThreshold: 101 },
  { abundanceThreshold: -1 },
  { abundanceSize: "yes" },
  { connections: "genomic" },
]) {
  assert.throws(() =>
    validateSettings(
      { ...communitySettings, state: { ...communityState, ...patch } },
      communityData,
      ["cluster", "kraken_taxon"],
    ),
  );
}
for (const n of [1000, 10000]) {
  const data = Array.from({ length: n }, (_, i) => ({
    ...raw[i % 3],
    id: `sample-${i}`,
  }));
  const start = performance.now();
  const prepared = prepareObservations(data);
  assert.equal(prepared.obs.length, n);
  console.log(
    `${n} observations: model preparation ${(performance.now() - start).toFixed(1)} ms`,
  );
}
console.log("Space-time JavaScript checks passed.");
