// Optional real-browser regression/benchmark. Requires Playwright in NODE_PATH.
// MYOGA_BROWSER=/path/to/chrome node scripts/space-time-browser-check.cjs /path/to/myoga /tmp/results
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function run() {
  const binary = path.resolve(process.argv[2]),
    out = path.resolve(process.argv[3]);
  fs.mkdirSync(out, { recursive: true });
  const makeFigure = (name, args) => {
    const file = path.join(out, name + ".html");
    execFileSync(binary, ["space-time", ...args, "--output", file], {
      stdio: "pipe",
    });
    return file;
  };
  const example = makeFigure("synthetic", [
    "--metadata",
    "example/space-time/metadata.tsv",
    "--distances",
    "example/space-time/distances.tsv",
    "--color-by",
    "lineage",
  ]);
  const browser = await chromium.launch({
    executablePath: process.env.MYOGA_BROWSER || undefined,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [],
    network = [],
    results = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  async function settled() {
    await page.waitForTimeout(100);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const p = document.getElementById("plot");
          if (!p._transitioning && !p._redrawTimer) resolve();
          else p.once("plotly_afterplot", resolve);
        }),
    );
  }
  async function change(selector, value) {
    await page.evaluate(() => {
      window.checkAfterPlot = false;
      document
        .getElementById("plot")
        .once("plotly_afterplot", () => (window.checkAfterPlot = true));
    });
    const start = Date.now();
    await page.locator(selector).selectOption(value);
    await page.waitForFunction(() => window.checkAfterPlot, { timeout: 60000 });
    return Date.now() - start;
  }
  try {
    await page.goto(pathToFileURL(example).href);
    await page.waitForFunction(
      () => document.getElementById("status").textContent.includes("72 / 72"),
      { timeout: 60000 },
    );
    assert.equal(await page.locator("#error").textContent(), "");
    await change("#connections", "genomic");
    assert.match(
      await page.locator("#status").textContent(),
      /191 genomic-neighbor edges/,
    );
    await page.locator("#legend button").first().click();
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("30 / 72"),
    );
    await page.locator("#legend button").first().click();
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("72 / 72"),
    );
    await page
      .locator("summary")
      .filter({ hasText: "Combine metadata filters" })
      .click();
    await page.locator("#filter-column").selectOption("lineage");
    await page.locator("#add-filter").click();
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("30 / 72"),
    );
    await page.locator("#filter-column").selectOption("isolation_source");
    await page.locator("#add-filter").click();
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("12 / 72"),
    );
    await page.locator("#clear-filters").click();
    await page.locator("#sample-search").fill("SYN-001");
    await page.locator("#sample-select").selectOption("0");
    assert.match(
      await page.locator("#sample-details").textContent(),
      /2019-12-31/,
    );
    for (const id of ["top", "side", "oblique"]) {
      await page.locator("#" + id).click();
      await page.waitForTimeout(150);
    }
    await page.locator("#reset").click();
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("3 / 72"),
    );
    await page.locator("#play").click();
    await page.waitForTimeout(800);
    await page.locator("#pause").click();
    assert.notEqual(await page.locator("#clock").textContent(), "2019-01-01");
    await page.locator("#full").click();
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("72 / 72"),
    );
    const [settings] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#save-settings").click(),
    ]);
    const settingsPath = path.join(out, "settings.json");
    await settings.saveAs(settingsPath);
    await change("#color", "site");
    await page.locator("#load-settings").setInputFiles(settingsPath);
    await page.waitForFunction(
      () => document.getElementById("color").value === "lineage",
    );
    await settled();
    await page.locator("#export-width").fill("1600");
    await page.locator("#export-height").fill("1100");
    for (const format of ["png", "svg"]) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.locator("#" + format).click(),
      ]);
      await download.saveAs(path.join(out, "synthetic." + format));
    }
    const png = fs.readFileSync(path.join(out, "synthetic.png"));
    assert.equal(png.readUInt32BE(16), 1600);
    assert.equal(png.readUInt32BE(20), 1100);
    assert.match(
      fs.readFileSync(path.join(out, "synthetic.svg"), "utf8"),
      /data:image\/png/,
    );
    await page.screenshot({
      path: path.join(out, "interface.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await settled();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "mobile horizontal overflow",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    const community = makeFigure("community", [
      "--metadata",
      "example/metagenomics/metadata.tsv",
      "--kraken-reports",
      "example/metagenomics/reports",
    ]);
    await page.goto(pathToFileURL(community).href);
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("6 / 7 taxon observations"),
    );
    assert.equal(await page.locator("#community-controls").isVisible(), true);
    assert.equal(await page.locator("#genomic-controls").isVisible(), false);
    assert.equal(await page.locator("#color").inputValue(), "kraken_taxon");
    await page.locator("#abundance-value").fill("50");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("3 / 7 taxon observations"),
    );
    await page.locator("#abundance-value").fill("0.1");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("7 / 7 taxon observations"),
    );
    await page.locator("#abundance-value").fill("100");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("0 / 7 taxon observations"),
    );
    await page.locator("#sample-select").selectOption("0");
    assert.match(
      await page.locator("#sample-details").textContent(),
      /below display threshold/,
    );
    await page.locator("#sample-select").selectOption("3");
    assert.match(
      await page.locator("#sample-details").textContent(),
      /unclassified_fragments1000/,
    );
    await page.locator("#sample-select").selectOption("4");
    assert.match(
      await page.locator("#sample-details").textContent(),
      /Missing report/,
    );
    const [communitySettings] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#save-settings").click(),
    ]);
    const communitySettingsPath = path.join(out, "community-settings.json");
    await communitySettings.saveAs(communitySettingsPath);
    await page.locator("#abundance-value").fill("1");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("6 / 7 taxon observations"),
    );
    await page.locator("#load-settings").setInputFiles(communitySettingsPath);
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("0 / 7 taxon observations"),
    );
    await page.locator("#abundance-value").fill("1");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("6 / 7 taxon observations"),
    );
    const [communityPNG] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#png").click(),
    ]);
    await communityPNG.saveAs(path.join(out, "community.png"));
    assert.equal(await page.locator("#error").textContent(), "");
    const unclassifiedMetadata = path.join(out, "unclassified.tsv");
    fs.writeFileSync(
      unclassifiedMetadata,
      "sample_id\tlatitude\tlongitude\tcollection_date\nS04\t45.5\t-73.5\t2025-06-02\n",
    );
    const unclassified = makeFigure("unclassified", [
      "--metadata",
      unclassifiedMetadata,
      "--kraken-reports",
      "example/metagenomics/reports",
    ]);
    await page.goto(pathToFileURL(unclassified).href);
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        .textContent.includes("0 / 0 taxon observations"),
    );
    await page.locator("#sample-select").selectOption("0");
    assert.match(
      await page.locator("#sample-details").textContent(),
      /unclassified_fragments1000/,
    );
    assert.equal(await page.locator("#error").textContent(), "");
    for (const n of [1000, 10000]) {
      const metadata = path.join(out, `metadata-${n}.tsv`);
      let text = "sample_id\tlatitude\tlongitude\tcollection_date\tcluster\n";
      for (let i = 0; i < n; i++)
        text += `SYN-${i}\t${40 + (i % 100) / 100}\t${-75 + (i % 113) / 100}\t${2019 + (i % 7)}-${String(1 + (i % 12)).padStart(2, "0")}-15\tC${i % 12}\n`;
      fs.writeFileSync(metadata, text);
      const file = makeFigure(`benchmark-${n}`, ["--metadata", metadata]);
      const start = Date.now();
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(
        () =>
          document
            .getElementById("status")
            .textContent.includes("observations visible"),
        { timeout: 60000 },
      );
      const initial = Date.now() - start,
        recolor = await change("#color", "collection_date");
      const camera = await page.evaluate(async () => {
        const start = performance.now();
        await Plotly.relayout(document.getElementById("plot"), {
          "scene.camera.eye": { x: 1.5, y: -1, z: 1.4 },
        });
        return performance.now() - start;
      });
      results.push({
        samples: n,
        htmlBytes: fs.statSync(file).size,
        initialMs: initial,
        recolorMs: recolor,
        cameraRelayoutMs: Math.round(camera),
      });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    fs.writeFileSync(
      path.join(out, "benchmark.json"),
      JSON.stringify(
        { renderer: "Chrome headless / SwiftShader (software WebGL)", results },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results, null, 2));
    console.log(
      "Browser controls, exports, offline behavior and benchmarks passed.",
    );
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
