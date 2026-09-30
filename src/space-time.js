/* Shared pure functions are exported for dependency-free Node checks. */
(function () {
  "use strict";
  const DAY = 86400000;
  function colorFor(value) {
    let hash = 0;
    for (const char of String(value || "missing"))
      hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    // Hex keeps the HTML legend and WebGL renderer on the same RGB values.
    const hue = Math.abs(hash) % 360,
      lightness = 0.38,
      amplitude = 0.65 * Math.min(lightness, 1 - lightness);
    const channel = (n) => {
      const k = (n + hue / 30) % 12;
      return Math.round(
        255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
      )
        .toString(16)
        .padStart(2, "0");
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  }
  function escapeHTML(value) {
    return String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function day(value) {
    return Date.parse(value + "T00:00:00Z") / DAY;
  }
  function date(value) {
    return new Date(Math.round(value) * DAY).toISOString().slice(0, 10);
  }
  function category(o, field) {
    return o.metadata[field] || "(missing)";
  }
  function visibility(o, state, cursor) {
    if (
      o.community &&
      (o.community.percent <= 0 ||
        o.community.percent < state.abundanceThreshold)
    )
      return 0;
    if (
      Object.entries(state.filters).some(
        ([key, value]) => category(o, key) !== value,
      )
    )
      return 0;
    if (state.isolate !== null && category(o, state.color) !== state.isolate)
      return 0;
    if (state.full) return 1;
    if (o.startDay > cursor) return 0;
    if (o.endDay < cursor - state.window + 1)
      return state.history === "window"
        ? 0
        : state.history === "fade"
          ? 0.15
          : 1;
    return 1;
  }
  function thresholdEdges(edges, threshold, visible) {
    // Preprocessing sorts the bounded graph, so threshold filtering stops early.
    const result = [];
    for (const e of edges) {
      if (e.distance > threshold) break;
      if (visible[e.a] && visible[e.b]) result.push(e);
    }
    return result;
  }
  function communityObservations(data) {
    if (!data.community) return data.observations;
    return data.community.profiles.flatMap((profile) =>
      profile.taxa
        .filter((taxon) => taxon.clade > 0)
        .map((taxon) => {
          const sample = data.observations[profile.sample];
          const label = `${taxon.name} [${taxon.taxid}]`;
          return {
            ...sample,
            id: `${sample.id} · ${label}`,
            community: { ...taxon, sample: profile.sample },
            metadata: {
              ...sample.metadata,
              kraken_taxon: label,
              kraken_taxid: taxon.taxid,
              kraken_percent: String(taxon.percent),
              kraken_clade_fragments: String(taxon.clade),
              kraken_direct_fragments: String(taxon.direct),
              kraken_total_fragments: String(profile.total),
              kraken_sample_id: sample.id,
            },
          };
        }),
    );
  }
  function prepareObservations(
    observations,
    extentObservations = observations,
    offsetScale = 1,
  ) {
    // Place the seam in the largest unobserved longitude gap (including dateline datasets).
    const longs = [
      ...new Set(
        extentObservations.map((o) => ((o.longitude % 360) + 360) % 360),
      ),
    ].sort((a, b) => a - b);
    let gap = -1,
      origin = longs[0];
    longs.forEach((x, i) => {
      const next =
        longs[(i + 1) % longs.length] + (i === longs.length - 1 ? 360 : 0);
      if (next - x > gap) {
        gap = next - x;
        origin = next % 360;
      }
    });
    const unwrap = (lon) => ((((lon - origin) % 360) + 360) % 360) + origin;
    const obs = observations.map((o) => ({
      ...o,
      x: unwrap(o.longitude),
      y: o.latitude,
      startDay: day(o.start),
      endDay: day(o.end),
    }));
    const extent = (values, floor) => {
      let min = Infinity,
        max = -Infinity;
      for (const x of values) {
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
      const padding = Math.max((max - min) * 0.09, floor);
      return [min - padding, max + padding];
    };
    const xr = extent(
        extentObservations.map((o) => unwrap(o.longitude)),
        0.00001,
      ),
      yr = extent(
        extentObservations.map((o) => o.latitude),
        0.00001,
      );
    yr[0] = Math.max(-90, yr[0]);
    yr[1] = Math.min(90, yr[1]);
    const min = extentObservations.reduce(
        (v, o) => Math.min(v, day(o.start)),
        Infinity,
      ),
      max = extentObservations.reduce(
        (v, o) => Math.max(v, day(o.end)),
        -Infinity,
      );
    const cosine = Math.max(
      0.01,
      Math.cos((((yr[0] + yr[1]) / 2) * Math.PI) / 180),
    );
    // Add geographic context to narrow transects by expanding the ranges,
    // rather than stretching one geographic unit differently from another.
    const geographicSpan = Math.max((xr[1] - xr[0]) * cosine, yr[1] - yr[0]);
    const xPad = Math.max(
      0,
      ((geographicSpan * 0.2) / cosine - (xr[1] - xr[0])) / 2,
    );
    const yPad = Math.max(0, (geographicSpan * 0.2 - (yr[1] - yr[0])) / 2);
    xr[0] -= xPad;
    xr[1] += xPad;
    yr[0] = Math.max(-90, yr[0] - yPad);
    yr[1] = Math.min(90, yr[1] + yPad);
    // ponytail: rounded-coordinate bins are a display heuristic. Explicit site
    // IDs or a spatial index can replace them for denser, irregular site layouts.
    const groups = new Map();
    obs.forEach((o, i) => {
      const key = `${o.latitude.toFixed(6)},${o.longitude.toFixed(6)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    const radius =
      Math.min((xr[1] - xr[0]) * cosine, yr[1] - yr[0]) * 0.008 * offsetScale;
    for (const group of groups.values()) {
      group.sort((a, b) => obs[a].id.localeCompare(obs[b].id, "en"));
      group.forEach((i, j) => {
        const o = obs[i];
        const angle = j * 2.399963229728653;
        const r =
          group.length > 1 ? radius * Math.sqrt((j + 1) / group.length) : 0;
        o.dx = (Math.cos(angle) * r) / cosine;
        o.dy = Math.sin(angle) * r;
        o.siteCount = group.length;
      });
    }
    return {
      obs,
      unwrap,
      xr,
      yr,
      min,
      max,
      span: Math.max(1, max - min),
      cosine,
    };
  }
  function timeTicks(min, max, scale) {
    if (scale === "linear")
      scale = max - min >= 730 ? "year" : max - min >= 60 ? "month" : "day";
    const values = [];
    if (scale === "linear" || scale === "day" || max - min < 2) {
      const step = Math.max(1, Math.ceil((max - min) / 6));
      for (let d = min; d <= max; d += step) values.push(d);
    } else {
      const first = new Date(min * DAY),
        last = new Date(max * DAY);
      const monthly = scale === "month";
      const a = monthly
        ? first.getUTCFullYear() * 12 + first.getUTCMonth()
        : first.getUTCFullYear();
      const b = monthly
        ? last.getUTCFullYear() * 12 + last.getUTCMonth()
        : last.getUTCFullYear();
      const step = Math.max(1, Math.ceil((b - a + 1) / 7));
      for (let i = a; i <= b; i += step) {
        const y = monthly ? Math.floor(i / 12) : i,
          m = monthly ? (i % 12) + 1 : 1;
        const d = day(
          `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`,
        );
        if (d >= min && d <= max) values.push(d);
      }
    }
    if (!values.length) values.push(min);
    return {
      tickvals: values.map((v) => v - min),
      ticktext: values.map((v) =>
        scale === "year"
          ? date(v).slice(0, 4)
          : scale === "month"
            ? date(v).slice(0, 7)
            : date(v),
      ),
    };
  }
  function validateSettings(raw, data, headers) {
    if (!raw || raw.version !== 1 || raw.fingerprint !== data.fingerprint)
      throw Error("Settings belong to a different dataset or version.");
    const s = raw.state;
    if (
      data.community &&
      (!s ||
        !Number.isFinite(s.abundanceThreshold) ||
        s.abundanceThreshold < 0 ||
        s.abundanceThreshold > 100 ||
        typeof s.abundanceSize !== "boolean" ||
        s.connections !== "none")
    )
      throw Error("Invalid community settings.");
    if (
      !s ||
      !headers.includes(s.color) ||
      !headers.includes(s.tooltip) ||
      !["retain", "window", "fade"].includes(s.history) ||
      !["none", "genomic"].includes(s.connections) ||
      !["linear", "year", "month", "day"].includes(s.timeScale)
    )
      throw Error("Invalid settings fields.");
    for (const [key, lo, hi] of [
      ["cursor", 0, 1000],
      ["window", 1, 3652500],
      ["speed", 0.5, 5],
      ["height", 0.2, 3],
      ["threshold", 0, data.distanceMax],
      ["exportWidth", 400, 6000],
      ["exportHeight", 400, 6000],
    ])
      if (!Number.isFinite(s[key]) || s[key] < lo || s[key] > hi)
        throw Error(`Invalid setting: ${key}`);
    for (const key of [
      "full",
      "basemap",
      "uncertainty",
      "jitter",
      "edgeOpacity",
    ])
      if (typeof s[key] !== "boolean") throw Error(`Invalid setting: ${key}`);
    if (
      !["white", "transparent"].includes(s.background) ||
      !(s.isolate === null || typeof s.isolate === "string") ||
      !s.filters ||
      Array.isArray(s.filters) ||
      typeof s.filters !== "object"
    )
      throw Error("Invalid filter or background settings.");
    for (const [key, value] of Object.entries(s.filters))
      if (!headers.includes(key) || typeof value !== "string")
        throw Error("Invalid metadata filter.");
    if (
      !s.camera ||
      Object.keys(s.camera).some(
        (k) => !["eye", "up", "center", "projection"].includes(k),
      )
    )
      throw Error("Invalid camera.");
    for (const key of ["eye", "up", "center"])
      for (const axis of ["x", "y", "z"])
        if (
          !Number.isFinite(s.camera[key]?.[axis]) ||
          Math.abs(s.camera[key][axis]) > 10000
        )
          throw Error("Invalid camera vector.");
    if (
      s.camera.projection &&
      !["perspective", "orthographic"].includes(s.camera.projection.type)
    )
      throw Error("Invalid camera projection.");
    return JSON.parse(JSON.stringify(s));
  }
  const core = {
    colorFor,
    escapeHTML,
    day,
    date,
    visibility,
    thresholdEdges,
    prepareObservations,
    communityObservations,
    timeTicks,
    validateSettings,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = core;
    return;
  }

  async function main() {
    const $ = (id) => document.getElementById(id);
    const data = JSON.parse($("space-data").textContent),
      geography = JSON.parse($("space-geography").textContent);
    const model = prepareObservations(
        communityObservations(data),
        data.observations,
        data.community ? 3 : 1,
      ),
      { obs, min, max, span, xr, yr, cosine } = model;
    const headers = data.headers;
    const defaultColor =
      data.colorBy ||
      (data.community ? "kraken_taxon" : "") ||
      headers.find((h) =>
        /^(cluster|lineage|species|host|country)(_normalized)?$/i.test(h),
      ) ||
      headers[0];
    const figureTitle = data.community
      ? `MYOGA · ${data.observations.every((o) => o.metadata.data_type === "SYNTHETIC") ? "SYNTHETIC " : ""}microbial communities`
      : obs.every((o) => o.metadata.data_type === "SYNTHETIC")
        ? "MYOGA · SYNTHETIC space-time example"
        : "MYOGA · Space-time observations";
    const profiles = new Map(
      (data.community?.profiles || []).map((p) => [p.sample, p]),
    );
    const observationLabel = data.community
      ? "taxon observations"
      : "observations";
    let state = {
      color: defaultColor,
      tooltip: defaultColor,
      filters: {},
      isolate: null,
      full: true,
      cursor: 1000,
      history: "retain",
      window: 30,
      speed: 1,
      height: 1.2,
      timeScale: "linear",
      basemap: true,
      uncertainty: true,
      jitter: true,
      connections: "none",
      threshold: data.relationships.length
        ? data.relationships[Math.floor((data.relationships.length - 1) / 2)]
            .distance
        : 0,
      edgeOpacity: true,
      abundanceThreshold: data.community?.threshold ?? 1,
      abundanceSize: true,
      exportWidth: 2400,
      exportHeight: 1600,
      background: "white",
      camera: {
        eye: { x: 1.45, y: -1.65, z: 1.15 },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 0, z: 0 },
        projection: { type: "orthographic" },
      },
    };
    const defaultCamera = JSON.parse(JSON.stringify(state.camera));
    let playing = false,
      lastFrame = 0,
      busy = false,
      queued = false,
      initialized = false,
      timer = null;
    const plot = $("plot");
    const options = (select, values) => {
      select.replaceChildren(...values.map((v) => new Option(v, v)));
    };
    for (const id of ["color", "tooltip-field", "filter-column"])
      options($(id), headers);
    const available = new Map(
      headers.map((h) => [
        h,
        [...new Set(obs.map((o) => category(o, h)))].sort(),
      ]),
    );
    const reasonable = headers.filter(
      (h) => available.get(h).length > 1 && available.get(h).length <= 100,
    );
    options($("filter-column"), reasonable.length ? reasonable : headers);
    $("threshold").max = String(data.distanceMax || 0);
    $("threshold").disabled = !data.relationships.length;
    $("connections").options[1].disabled = !data.relationships.length;
    $("edge-note").textContent =
      `Sparse graph: ${data.relationships.length.toLocaleString()} retained edges; maximum ${data.maxPerSample} per sample / ${data.maxEdges.toLocaleString()} total. The threshold filters this retained subset only.`;
    if (data.community) {
      $("community-controls").hidden = false;
      $("genomic-controls").hidden = true;
      $("view-description").textContent =
        "Observed geography · collection time · taxon proportions";
      $("community-summary").textContent =
        `Rank ${data.community.rank} · ${profiles.size} reports / ${data.observations.length} mapped samples. Percentage = taxon clade fragments / all report fragments, including unclassified. Marker areas use a fixed proportion scale across samples and dates.`;
    }
    $("date-range").textContent = `${date(min)} — ${date(max)}`;
    const report = {
      loaded: data.loaded,
      mapped: data.observations.length,
      ...(data.community
        ? {
            communityRank: data.community.rank,
            krakenReports: profiles.size,
            taxonObservations: obs.length,
          }
        : {}),
      excluded: data.excluded,
      warnings: data.warnings,
    };
    const counts = {};
    for (const e of data.excluded)
      counts[e.reason] = (counts[e.reason] || 0) + 1;
    $("report").textContent =
      JSON.stringify({ ...report, excluded: counts }, null, 2) +
      "\n\nExport report for row-level exclusions.";

    function syncControls() {
      for (const [id, key] of Object.entries({
        color: "color",
        "tooltip-field": "tooltip",
        history: "history",
        window: "window",
        speed: "speed",
        height: "height",
        "time-scale": "timeScale",
        connections: "connections",
        threshold: "threshold",
        cursor: "cursor",
        "export-width": "exportWidth",
        "export-height": "exportHeight",
        background: "background",
        "abundance-threshold": "abundanceThreshold",
        "abundance-value": "abundanceThreshold",
      }))
        $(id).value = state[key];
      for (const [id, key] of Object.entries({
        basemap: "basemap",
        uncertainty: "uncertainty",
        jitter: "jitter",
        "edge-opacity": "edgeOpacity",
        "abundance-size": "abundanceSize",
      }))
        $(id).checked = state[key];
      renderLegend();
      renderFilters();
    }
    function renderLegend() {
      const q = $("legend-search").value.toLowerCase();
      const values = available
        .get(state.color)
        .filter((v) => v.toLowerCase().includes(q));
      $("legend").replaceChildren();
      for (const value of values.slice(0, 100)) {
        const button = document.createElement("button"),
          swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = colorFor(value);
        button.append(swatch, document.createTextNode(value));
        button.setAttribute("aria-pressed", String(state.isolate === value));
        button.onclick = () => {
          state.isolate = state.isolate === value ? null : value;
          renderLegend();
          schedule();
        };
        $("legend").append(button);
      }
      if (values.length > 100) {
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = `${values.length} categories; showing the first 100. Search to find others.`;
        $("legend").append(note);
      }
    }
    function renderFilters() {
      $("filter-list").replaceChildren();
      for (const [field, value] of Object.entries(state.filters)) {
        const row = document.createElement("div"),
          label = document.createElement("label"),
          select = document.createElement("select"),
          remove = document.createElement("button");
        row.className = "row";
        label.append(document.createTextNode(field));
        options(select, available.get(field));
        select.value = value;
        select.onchange = () => {
          state.filters[field] = select.value;
          schedule();
        };
        label.append(select);
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${field} filter`);
        remove.onclick = () => {
          delete state.filters[field];
          renderFilters();
          schedule();
        };
        row.append(label, remove);
        $("filter-list").append(row);
      }
    }
    function sampleOptions() {
      const q = $("sample-search").value.toLowerCase();
      const samples = data.community ? data.observations : obs;
      const selected = samples
        .filter((o) => o.id.toLowerCase().includes(q))
        .slice(0, 100);
      $("sample-select").replaceChildren(
        new Option("Choose sample (first 100 matches)", ""),
        ...selected.map((o) => new Option(o.id, String(samples.indexOf(o)))),
      );
    }
    function showSample(i) {
      const o = obs[i];
      if (!o) return;
      if (o.community) {
        showCommunitySample(o.community.sample, o.community.taxid);
        return;
      }
      const details = {
        sample_id: o.id,
        latitude: o.latitude,
        longitude: o.longitude,
        time_start: o.start,
        time_end: o.end,
        time_precision: o.precision,
        observations_at_site: o.siteCount,
        display_offset: state.jitter
          ? "deterministic schematic displacement"
          : "none",
        ...o.metadata,
      };
      fillDetails(details);
    }
    function showCommunitySample(i, selectedTaxid = null) {
      const sample = data.observations[i],
        profile = profiles.get(i);
      if (!sample) return;
      const details = {
        ...sample.metadata,
        sample_id: sample.id,
        latitude: sample.latitude,
        longitude: sample.longitude,
        time_start: sample.start,
        time_end: sample.end,
        time_precision: sample.precision,
        kraken_report_status: profile
          ? "Imported"
          : "Missing report — not zero abundance",
      };
      if (profile) {
        details.kraken_report = profile.report;
        details.total_fragments = profile.total;
        details.unclassified_fragments = profile.unclassified;
        details.unclassified_percent = (
          (100 * profile.unclassified) /
          profile.total
        ).toFixed(4);
        details.reported_taxa_at_rank = profile.taxa.length;
        for (const taxon of profile.taxa)
          details[
            `${taxon.taxid === selectedTaxid ? "Selected: " : ""}${taxon.name} [${taxon.taxid}]`
          ] =
            `${taxon.percent.toPrecision(6)}% · ${taxon.clade} clade fragments / ${profile.total} total; ${taxon.direct} direct${taxon.percent < state.abundanceThreshold ? " · below display threshold" : ""}${taxon.clade === 0 ? " · no assigned fragments" : ""}`;
      }
      fillDetails(details);
    }
    function fillDetails(details) {
      $("sample-details").replaceChildren();
      for (const [key, value] of Object.entries(details)) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = key;
        dd.textContent = String(value);
        $("sample-details").append(dt, dd);
      }
    }
    function download(name, content, type) {
      const a = document.createElement("a"),
        url = URL.createObjectURL(new Blob([content], { type }));
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function error(e) {
      $("error").textContent = e.message || String(e);
    }

    // Clip bundled boundaries to the displayed region, including seam-crossing segments.
    function clip(x1, y1, x2, y2) {
      const dx = x2 - x1,
        dy = y2 - y1;
      let a = 0,
        b = 1;
      for (const [p, q] of [
        [-dx, x1 - xr[0]],
        [dx, xr[1] - x1],
        [-dy, y1 - yr[0]],
        [dy, yr[1] - y1],
      ]) {
        if (p === 0) {
          if (q < 0) return null;
        } else {
          const r = q / p;
          if (p < 0) a = Math.max(a, r);
          else b = Math.min(b, r);
          if (a > b) return null;
        }
      }
      return [x1 + a * dx, y1 + a * dy, x1 + b * dx, y1 + b * dy];
    }
    const base = { x: [], y: [], z: [] };
    const floor = -span * 0.04;
    for (const feature of geography.features) {
      const g = feature.geometry;
      if (!g) continue;
      const polygons =
        g.type === "Polygon"
          ? [g.coordinates]
          : g.type === "MultiPolygon"
            ? g.coordinates
            : [];
      for (const polygon of polygons)
        for (const ring of polygon)
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1],
              b = ring[i];
            let ax = model.unwrap(a[0]),
              bx = model.unwrap(b[0]);
            if (bx - ax > 180) bx -= 360;
            if (ax - bx > 180) bx += 360;
            for (const shift of [-360, 0, 360]) {
              const c = clip(ax + shift, a[1], bx + shift, b[1]);
              if (c) {
                base.x.push(c[0], c[2], null);
                base.y.push(c[1], c[3], null);
                base.z.push(floor, floor, null);
              }
            }
          }
    }
    const sites = [
      ...new Map(
        data.observations.map((o) => [
          `${o.latitude},${o.longitude}`,
          { ...o, x: model.unwrap(o.longitude), y: o.latitude },
        ]),
      ).values(),
    ];
    function lineTrace(name, color, opacity = 1, width = 2) {
      return {
        type: "scatter3d",
        mode: "lines",
        name,
        x: [],
        y: [],
        z: [],
        line: { color, width },
        opacity,
        hoverinfo: "skip",
        showlegend: false,
        connectgaps: false,
      };
    }
    function segment(trace, a, b) {
      trace.x.push(a[0], b[0], null);
      trace.y.push(a[1], b[1], null);
      trace.z.push(a[2], b[2], null);
    }
    const position = (o) => [
      o.x + (state.jitter ? o.dx : 0),
      Math.max(-90, Math.min(90, o.y + (state.jitter ? o.dy : 0))),
      (o.startDay + o.endDay) / 2 - min,
    ];
    function buildFigure() {
      const cursor = Math.round(min + ((max - min) * state.cursor) / 1000),
        visible = obs.map((o) => visibility(o, state, cursor));
      const traces = [];
      const uncertainty = lineTrace("Collection interval", "#75897e", 0.45, 3);
      if (data.community) {
        const anchorState = {
          ...state,
          isolate: null,
          filters: Object.fromEntries(
            Object.entries(state.filters).filter(
              ([key]) => !key.startsWith("kraken_"),
            ),
          ),
        };
        const samples = data.observations
          .map((sample, i) => ({
            ...sample,
            index: i,
            startDay: day(sample.start),
            endDay: day(sample.end),
          }))
          .filter((sample) => visibility(sample, anchorState, cursor));
        traces.push({
          type: "scatter3d",
          mode: "markers",
          name: "Sample anchors",
          x: samples.map((o) => model.unwrap(o.longitude)),
          y: samples.map((o) => o.latitude),
          z: samples.map((o) => (o.startDay + o.endDay) / 2 - min),
          customdata: samples.map((o) => `sample:${o.index}`),
          text: samples.map(
            (o) =>
              `${escapeHTML(o.id)}<br>${profiles.has(o.index) ? "Sample anchor · report imported" : "Missing report · not zero abundance"}`,
          ),
          marker: {
            size: 3,
            color: "#717b75",
            symbol: "diamond",
            opacity: 0.5,
          },
          hovertemplate: "%{text}<extra></extra>",
          showlegend: false,
        });
      }
      if (state.basemap) {
        traces.push({
          type: "mesh3d",
          x: [xr[0], xr[1], xr[1], xr[0]],
          y: [yr[0], yr[0], yr[1], yr[1]],
          z: [floor, floor, floor, floor],
          i: [0, 0],
          j: [1, 2],
          k: [2, 3],
          color: "#e8efea",
          opacity: 0.45,
          hoverinfo: "skip",
          showlegend: false,
          flatshading: true,
        });
        traces.push({
          ...lineTrace("Geographic boundaries", "#9aac9f", 0.8, 2),
          ...base,
        });
        traces.push({
          type: "scatter3d",
          mode: "markers",
          name: "Sampled sites",
          x: sites.map((o) => o.x),
          y: sites.map((o) => o.y),
          z: sites.map(() => floor),
          marker: { size: 2, color: "#54776b" },
          hoverinfo: "skip",
          showlegend: false,
        });
      }
      const pointTrace = (opacity) => ({
        type: "scatter3d",
        mode: "markers",
        name: "Observations",
        x: [],
        y: [],
        z: [],
        text: [],
        customdata: [],
        marker: {
          size: data.community ? [] : state.connections === "genomic" ? 5 : 4,
          color: [],
          opacity,
          line: { width: 0 },
        },
        hovertemplate: "%{text}<extra></extra>",
        showlegend: false,
      });
      const current = pointTrace(1),
        past = pointTrace(0.16);
      obs.forEach((o, i) => {
        if (!visible[i]) return;
        const p = position(o),
          trace = visible[i] === 1 ? current : past;
        trace.x.push(p[0]);
        trace.y.push(p[1]);
        trace.z.push(p[2]);
        trace.customdata.push(i);
        trace.marker.color.push(colorFor(category(o, state.color)));
        if (data.community)
          trace.marker.size.push(
            state.abundanceSize ? 2.4 * Math.sqrt(o.community.percent) : 5,
          );
        const lines = [
          `<b>${escapeHTML(o.id)}</b>`,
          `${o.start} — ${o.end} (${escapeHTML(o.precision)})`,
          `True coordinates: ${o.latitude}, ${o.longitude}`,
          `${escapeHTML(state.color)}: ${escapeHTML(category(o, state.color))}`,
        ];
        if (state.tooltip !== state.color)
          lines.push(
            `${escapeHTML(state.tooltip)}: ${escapeHTML(category(o, state.tooltip))}`,
          );
        if (o.siteCount > 1)
          lines.push(`${o.siteCount} ${observationLabel} at this site`);
        if (o.community)
          lines.push(
            `${o.community.percent.toPrecision(6)}% of all fragments · ${o.community.clade} clade / ${profiles.get(o.community.sample).total} total`,
            `Sample: ${escapeHTML(data.observations[o.community.sample].id)}`,
          );
        trace.text.push(lines.join("<br>"));
        if (state.uncertainty && o.startDay !== o.endDay)
          segment(
            uncertainty,
            [p[0], p[1], o.startDay - min],
            [p[0], p[1], o.endDay - min],
          );
      });
      const edges =
        state.connections === "genomic"
          ? thresholdEdges(data.relationships, state.threshold, visible)
          : [];
      const edgeTraces = [0.8, 0.55, 0.32, 0.14].map((opacity) =>
        lineTrace("Genomic neighbors", "#3d6c78", opacity, 2),
      );
      const edgeScale =
        data.relationships[data.relationships.length - 1]?.distance || 1;
      for (const e of edges) {
        let bin = state.edgeOpacity
          ? Math.min(3, Math.floor((e.distance / edgeScale) * 4))
          : 1;
        if (visible[e.a] < 1 || visible[e.b] < 1) bin = 3;
        segment(edgeTraces[bin], position(obs[e.a]), position(obs[e.b]));
      }
      traces.push(...edgeTraces.filter((t) => t.x.length));
      if (uncertainty.x.length) traces.push(uncertainty);
      traces.push(past, current);
      const ticks = timeTicks(min, max, state.timeScale),
        categories = [
          ...new Set(
            obs
              .filter((_, i) => visible[i])
              .map((o) => category(o, state.color)),
          ),
        ].sort();
      const legend = categories
        .slice(0, 20)
        .map(
          (value) =>
            `<span style="color:${colorFor(value)}">●</span> ${escapeHTML(value.length > 35 ? value.slice(0, 32) + "…" : value)}`,
        );
      if (categories.length > 20)
        legend.push(`+ ${categories.length - 20} categories (see controls)`);
      const width = (xr[1] - xr[0]) * cosine,
        depth = yr[1] - yr[0],
        longest = Math.max(width, depth);
      const bg = state.background === "white" ? "#ffffff" : "rgba(0,0,0,0)";
      const xticks = Array.from(
        { length: 5 },
        (_, i) => xr[0] + ((xr[1] - xr[0]) * i) / 4,
      );
      const axis = {
        showbackground: false,
        gridcolor: "#dbe4dc",
        zeroline: false,
        showspikes: false,
      };
      const layout = {
        paper_bgcolor: bg,
        plot_bgcolor: bg,
        font: { family: "Arial, sans-serif", color: "#254139", size: 12 },
        margin: { l: 5, r: 5, t: 55, b: 50 },
        title: { text: figureTitle, x: 0.03, font: { size: 17 } },
        showlegend: false,
        uirevision: "space-time-v1",
        scene: {
          domain: { x: [0, 0.8], y: [0.08, 1] },
          camera: state.camera,
          dragmode: "orbit",
          aspectmode: "manual",
          aspectratio: {
            x: width / longest,
            y: depth / longest,
            z: state.height,
          },
          bgcolor: bg,
          xaxis: {
            ...axis,
            title: "Longitude (°)",
            range: xr,
            tickvals: xticks,
            ticktext: xticks.map(
              (v) => `${(((((v + 180) % 360) + 360) % 360) - 180).toFixed(3)}°`,
            ),
          },
          yaxis: { ...axis, title: "Latitude (°)", range: yr },
          zaxis: { ...axis, title: "", range: [floor, span * 1.03], ...ticks },
        },
        annotations: [
          {
            xref: "paper",
            yref: "paper",
            x: 0.02,
            y: 0.96,
            showarrow: false,
            text: "Collection time ↑",
            font: { size: 12 },
          },
          {
            xref: "paper",
            yref: "paper",
            x: 0.82,
            y: 1,
            xanchor: "left",
            yanchor: "top",
            showarrow: false,
            align: "left",
            text: `<b>${escapeHTML(state.color)}</b><br>${legend.join("<br>")}`,
            font: { size: 11 },
          },
          {
            xref: "paper",
            yref: "paper",
            x: 0,
            y: 0.02,
            xanchor: "left",
            showarrow: false,
            text: `${state.full ? "Full history" : date(cursor) + " · " + state.history} · ${visible.filter(Boolean).length} ${observationLabel} · intervals show date uncertainty`,
            font: { size: 10 },
          },
          {
            xref: "paper",
            yref: "paper",
            x: 1,
            y: 0,
            xanchor: "right",
            showarrow: false,
            text: data.community
              ? `Rank ${data.community.rank} · ≥ ${state.abundanceThreshold}% of all fragments · ${state.abundanceSize ? "area ∝ proportion" : "equal-size markers"} · ${state.jitter ? "schematic offsets" : "true coordinates"} · not absolute concentration`
              : edges.length
                ? "Genomic similarity ≠ direct transmission"
                : "Observation locations; temporal midpoints are display anchors",
            font: { size: 10 },
          },
        ],
      };
      return { traces, layout, visible, edges, cursor };
    }
    async function render() {
      if (busy) {
        queued = true;
        return;
      }
      busy = true;
      try {
        const f = buildFigure();
        await Plotly.react(plot, f.traces, f.layout, {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ["toImage"],
          scrollZoom: true,
        });
        if (!initialized) {
          initialized = true;
          plot.on("plotly_click", (e) => {
            const i = e.points?.[0]?.customdata;
            if (Number.isInteger(i)) showSample(i);
            else if (typeof i === "string" && i.startsWith("sample:"))
              showCommunitySample(Number(i.slice(7)));
          });
          plot.on("plotly_relayout", (e) => {
            if (e["scene.camera"])
              state.camera = JSON.parse(JSON.stringify(e["scene.camera"]));
          });
        }
        $("status").textContent =
          `${f.visible.filter(Boolean).length.toLocaleString()} / ${obs.length.toLocaleString()} ${observationLabel} visible · ${data.excluded.length} metadata rows excluded · ${data.community ? `${profiles.size} reports / ${data.observations.length} samples · ≥ ${state.abundanceThreshold}%` : `${f.edges.length.toLocaleString()} genomic-neighbor edges`}`;
        $("clock").textContent = state.full
          ? "Full sampled history"
          : date(f.cursor);
        $("threshold-value").textContent =
          `≤ ${state.threshold.toPrecision(5)} ${data.distanceLabel}`;
      } catch (e) {
        error(e);
        stop();
      } finally {
        busy = false;
        if (queued) {
          queued = false;
          schedule();
        }
      }
    }
    function schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        render();
      }, 30);
    }
    function stop() {
      playing = false;
      $("play").disabled = false;
    }
    async function playback(now) {
      if (!playing) return;
      if (!busy && now - lastFrame >= 180) {
        state.cursor = Math.min(
          1000,
          state.cursor + ((now - lastFrame) / 30000) * 1000 * state.speed,
        );
        lastFrame = now;
        $("cursor").value = state.cursor;
        await render();
      }
      if (state.cursor >= 1000) {
        stop();
        return;
      }
      requestAnimationFrame(playback);
    }
    for (const [id, key] of Object.entries({
      history: "history",
      "time-scale": "timeScale",
      connections: "connections",
      background: "background",
      "tooltip-field": "tooltip",
    }))
      $(id).onchange = () => {
        state[key] = $(id).value;
        schedule();
      };
    for (const [id, key, lo, hi] of [
      ["cursor", "cursor", 0, 1000],
      ["window", "window", 1, 3652500],
      ["speed", "speed", 0.5, 5],
      ["height", "height", 0.2, 3],
      ["threshold", "threshold", 0, data.distanceMax],
      ["export-width", "exportWidth", 400, 6000],
      ["export-height", "exportHeight", 400, 6000],
      ["abundance-threshold", "abundanceThreshold", 0, 100],
      ["abundance-value", "abundanceThreshold", 0, 100],
    ])
      $(id).oninput = () => {
        const v = Number($(id).value);
        if (!Number.isFinite(v) || v < lo || v > hi) return;
        state[key] = v;
        if (key === "abundanceThreshold") {
          $("abundance-threshold").value = v;
          $("abundance-value").value = v;
        }
        if (id === "cursor") {
          stop();
          state.full = false;
        }
        schedule();
      };
    for (const [id, key] of Object.entries({
      basemap: "basemap",
      uncertainty: "uncertainty",
      jitter: "jitter",
      "edge-opacity": "edgeOpacity",
      "abundance-size": "abundanceSize",
    }))
      $(id).onchange = () => {
        state[key] = $(id).checked;
        schedule();
      };
    $("color").onchange = () => {
      state.color = $("color").value;
      state.isolate = null;
      renderLegend();
      schedule();
    };
    $("legend-search").oninput = renderLegend;
    $("add-filter").onclick = () => {
      const h = $("filter-column").value;
      if (!available.get(h)?.length) return;
      state.filters[h] = available.get(h)[0];
      renderFilters();
      schedule();
    };
    $("clear-filters").onclick = () => {
      state.filters = {};
      state.isolate = null;
      renderFilters();
      renderLegend();
      schedule();
    };
    $("sample-search").oninput = sampleOptions;
    $("sample-select").onchange = () => {
      if ($("sample-select").value !== "")
        (data.community ? showCommunitySample : showSample)(
          Number($("sample-select").value),
        );
    };
    $("play").onclick = () => {
      state.full = false;
      if (state.cursor >= 1000) state.cursor = 0;
      playing = true;
      $("play").disabled = true;
      lastFrame = performance.now();
      requestAnimationFrame(playback);
    };
    $("pause").onclick = stop;
    $("reset").onclick = () => {
      stop();
      state.full = false;
      state.cursor = 0;
      syncControls();
      schedule();
    };
    $("full").onclick = () => {
      stop();
      state.full = true;
      state.cursor = 1000;
      syncControls();
      schedule();
    };
    for (const [id, eye] of [
      ["oblique", defaultCamera.eye],
      ["top", { x: 0, y: 0, z: 2.5 }],
      ["side", { x: 0, y: -2.5, z: 0.02 }],
    ])
      $(id).onclick = () => {
        state.camera = {
          ...JSON.parse(JSON.stringify(defaultCamera)),
          eye,
          up: id === "top" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 },
        };
        Plotly.relayout(plot, { "scene.camera": state.camera });
      };
    $("hide-controls").onclick = () => {
      document.body.classList.add("figure-mode");
      Plotly.Plots.resize(plot);
    };
    $("show-controls").onclick = () => {
      document.body.classList.remove("figure-mode");
      Plotly.Plots.resize(plot);
    };
    $("save-settings").onclick = () =>
      download(
        "myoga-space-time-settings.json",
        JSON.stringify(
          { version: 1, fingerprint: data.fingerprint, state },
          null,
          2,
        ),
        "application/json",
      );
    $("load-settings").onchange = async () => {
      try {
        const file = $("load-settings").files[0];
        if (!file) return;
        if (file.size > 1000000) throw Error("Settings file exceeds 1 MB.");
        const next = validateSettings(
          JSON.parse(await file.text()),
          data,
          headers,
        );
        for (const [h, v] of Object.entries(next.filters))
          if (!available.get(h).includes(v))
            throw Error("Unknown filter category.");
        stop();
        state = next;
        $("error").textContent = "";
        syncControls();
        await Plotly.relayout(plot, { "scene.camera": state.camera });
        schedule();
      } catch (e) {
        error(e);
      } finally {
        $("load-settings").value = "";
      }
    };
    $("save-report").onclick = () =>
      download(
        "myoga-space-time-validation.json",
        JSON.stringify(report, null, 2),
        "application/json",
      );
    for (const format of ["png", "svg"])
      $(format).onclick = async () => {
        stop();
        $(format).disabled = true;
        try {
          while (busy) await new Promise((resolve) => setTimeout(resolve, 50));
          await render();
          await Plotly.downloadImage(plot, {
            format,
            width: Math.round(state.exportWidth),
            height: Math.round(state.exportHeight),
            filename: "myoga-space-time",
          });
        } catch (e) {
          error(e);
        } finally {
          $(format).disabled = false;
        }
      };
    syncControls();
    sampleOptions();
    await render();
  }
  main().catch((e) => {
    document.getElementById("error").textContent = e.message || String(e);
  });
})();
