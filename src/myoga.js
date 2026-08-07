(function () {
  "use strict";

  const W = 1000;
  const H = 500;
  const MAX_GLOBE_ZOOM = 14;
  const MAX_FLAT_ZOOM = 48;
  const WORLD_MAP_URL = "assets/ne_50m_admin_0_countries.geojson";
  const US_COUNTIES_MAP_URL = "assets/us_counties_fips.geojson";
  const COLORS = ["#69d38f", "#6bb7ff", "#e8bd5c", "#e58ade", "#f0786f", "#9bc978", "#b7a1ff", "#69d2c4"];
  const TREE_CLADE_COLOR = "__tree_distance_clades__";
  const TREE_CLADE_PREFIX = "Tree clade ";
  const TREE_CLADE_UNMATCHED = "Tree clade (not in tree)";
  const MISSING = new Set(["", "na", "n/a", "none", "null", "missing", "unknown", "not provided", "not collected", "not determined", "not available"]);
  const ID_COLUMNS = ["genome", "genome_id", "sample", "sample_id", "isolate", "isolate_id", "strain", "accession", "assembly_accession", "name", "id"];
  const LAT_COLUMNS = ["latitude", "lat", "decimal_latitude", "decimal_lat", "y"];
  const LON_COLUMNS = ["longitude", "lon", "lng", "long", "decimal_longitude", "decimal_lon", "decimal_lng", "x"];
  const LAT_LON_COLUMNS = ["lat_lon", "latitude_longitude", "coordinates", "coord", "gps", "geographic_coordinates"];
  const LOCATION_COLUMNS = ["location", "geo_loc_name", "geographic_location", "country", "region", "place"];
  const DATE_COLUMNS = ["collection_date", "date", "sample_date", "isolation_date", "collection"];

  const COUNTRY_CENTROIDS = {
    Argentina: [-63.62, -38.42], Australia: [133.78, -25.27], Bangladesh: [90.36, 23.68],
    Algeria: [1.66, 28.03], Austria: [14.55, 47.52], Bolivia: [-63.59, -16.29],
    Belgium: [4.47, 50.50], Brazil: [-51.93, -14.24], Canada: [-106.35, 56.13],
    Chile: [-71.54, -35.68], China: [104.20, 35.86], Colombia: [-74.30, 4.57],
    "Costa Rica": [-83.75, 9.75], Croatia: [15.20, 45.10], Cuba: [-77.78, 21.52],
    Czechia: [15.47, 49.82], Denmark: [9.50, 56.26], Egypt: [30.80, 26.82],
    Ethiopia: [40.49, 9.15], Finland: [25.75, 61.92], France: [2.21, 46.23],
    Germany: [10.45, 51.17], Ghana: [-1.02, 7.95], India: [78.96, 20.59],
    Indonesia: [113.92, -0.79], Greece: [21.82, 39.07], Hungary: [19.50, 47.16],
    Iran: [53.69, 32.43], Iraq: [43.68, 33.22], Ireland: [-8.00, 53.42],
    Israel: [34.85, 31.05], Italy: [12.57, 41.87], Japan: [138.25, 36.20],
    Kenya: [37.91, -0.02], Malaysia: [101.98, 4.21], Mexico: [-102.55, 23.63],
    Netherlands: [5.29, 52.13], "New Zealand": [174.89, -40.90], Nigeria: [8.68, 9.08],
    Norway: [8.47, 60.47], Pakistan: [69.35, 30.38], Namibia: [18.49, -22.96],
    Nepal: [84.12, 28.39], Peru: [-75.02, -9.19], Philippines: [121.77, 12.88],
    Poland: [19.15, 51.92], Portugal: [-8.22, 39.40], "Republic of Korea": [127.77, 35.91],
    "Saudi Arabia": [45.08, 23.89], Romania: [24.97, 45.94], Russia: [105.32, 61.52],
    Serbia: [21.01, 44.02], "South Africa": [22.94, -30.56], Spain: [-3.75, 40.46],
    Sweden: [18.64, 60.47], "Sri Lanka": [80.77, 7.87], Sudan: [30.22, 12.86],
    Taiwan: [120.96, 23.70], Tanzania: [34.89, -6.37], Switzerland: [8.23, 46.82],
    Thailand: [100.99, 15.87], "Türkiye": [35.24, 38.96], Uganda: [32.29, 1.37],
    Ukraine: [31.17, 48.38], "United Kingdom": [-3.44, 55.38],
    Tunisia: [9.54, 33.89], "United States": [-95.71, 37.09], Uruguay: [-55.77, -32.52],
    "Viet Nam": [108.28, 14.06], Venezuela: [-66.59, 6.42], Zambia: [27.85, -13.13],
    Zimbabwe: [29.15, -19.02]
  };
  const COUNTRY_ALIASES = {
    USA: "United States", US: "United States", "United States of America": "United States",
    UK: "United Kingdom", "South Korea": "Republic of Korea", "Korea, South": "Republic of Korea",
    Turkey: "Türkiye", Vietnam: "Viet Nam"
  };
  const LAND = [
    [[-168, 72], [-52, 72], [-50, 50], [-78, 27], [-97, 15], [-116, 28], [-128, 49], [-168, 58]],
    [[-84, 12], [-36, 10], [-35, -56], [-67, -55], [-80, -20], [-92, -5]],
    [[-18, 35], [52, 37], [50, -35], [16, -35], [4, 5], [-14, 12]],
    [[-11, 72], [42, 71], [69, 48], [41, 35], [14, 36], [-10, 58]],
    [[35, 72], [179, 70], [178, 8], [112, -8], [79, 7], [46, 26]],
    [[112, -10], [154, -11], [154, -44], [113, -39]],
    [[-180, -62], [180, -62], [180, -86], [-180, -86]]
  ];

  const state = {
    ggrIds: new Set(),
    datasetKind: "generic",
    datasetLabel: "relatedness tree",
    treeText: "",
    treeRoot: null,
    treeTips: [],
    metadata: { headers: [], rows: [] },
    columnMap: {},
    genomes: [],
    filtered: [],
    selectedId: "",
    colorColumn: "",
    filterColumn: "",
    filterValue: "",
    treeCladeDepth: 0.10,
    worldFeatures: [],
    worldRings: [],
    worldGlobeRings: [],
    worldMapLoaded: false,
    customMapName: "",
    customRings: [],
    customBounds: null,
    mapMode: "globe",
    rotationLon: -40,
    rotationLat: 14,
    mapZoom: 1,
    flatPanX: 0,
    flatPanY: 0,
    controlsCollapsed: false,
    detailsCollapsed: false,
    treeCollapsed: false,
    drag: null,
    ignoreMapClicksUntil: 0,
    mapDrawFrame: 0,
    treeDrag: null
  };

  const el = {
    appShell: document.querySelector(".app-shell"),
    mlvamapsExport: byId("mlvamapsExport"),
    ggrFile: byId("ggrFile"),
    treeFile: byId("treeFile"),
    metadataFile: byId("metadataFile"),
    geojsonFile: byId("geojsonFile"),
    loadExample: byId("loadExample"),
    treeCount: byId("treeCount"),
    metadataCount: byId("metadataCount"),
    mappedCount: byId("mappedCount"),
    unmatchedCount: byId("unmatchedCount"),
    idColumn: byId("idColumn"),
    latColumn: byId("latColumn"),
    lonColumn: byId("lonColumn"),
    latLonColumn: byId("latLonColumn"),
    locationColumn: byId("locationColumn"),
    dateColumn: byId("dateColumn"),
    colorColumn: byId("colorColumn"),
    treeCladeControl: byId("treeCladeControl"),
    treeCladeDepth: byId("treeCladeDepth"),
    treeCladeDepthValue: byId("treeCladeDepthValue"),
    searchBox: byId("searchBox"),
    filterColumn: byId("filterColumn"),
    filterValue: byId("filterValue"),
    mappedOnly: byId("mappedOnly"),
    exportGeojson: byId("exportGeojson"),
    exportSession: byId("exportSession"),
    globeView: byId("globeView"),
    flatView: byId("flatView"),
    usCountiesMap: byId("usCountiesMap"),
    zoomIn: byId("zoomIn"),
    zoomOut: byId("zoomOut"),
    resetMap: byId("resetMap"),
    statusText: byId("statusText"),
    mapTitle: byId("mapTitle"),
    mapSvg: byId("mapSvg"),
    treeScroll: byId("treeScroll"),
    treeSvg: byId("treeSvg"),
    treeStatus: byId("treeStatus"),
    treeHeading: byId("treeHeading"),
    midpointRootTree: byId("midpointRootTree"),
    originalRootTree: byId("originalRootTree"),
    toggleControls: byId("toggleControls"),
    toggleDetails: byId("toggleDetails"),
    toggleTree: byId("toggleTree"),
    closeDetail: byId("closeDetail"),
    detailEmpty: byId("detailEmpty"),
    detailContent: byId("detailContent"),
    detailSource: byId("detailSource"),
    detailTitle: byId("detailTitle"),
    detailSubtitle: byId("detailSubtitle"),
    detailBasics: byId("detailBasics"),
    metadataTable: byId("metadataTable")
  };

  drawMap();
  bindEvents();
  applyPanelState();
  loadWorldMap();
  if (new URLSearchParams(window.location.search).has("example")) loadExample();

  function byId(id) {
    return document.getElementById(id);
  }

  function bindEvents() {
    el.mlvamapsExport.addEventListener("change", () => readMlvamapsExport(el.mlvamapsExport.files));
    el.ggrFile.addEventListener("change", () => readGgr(el.ggrFile.files[0]));
    el.treeFile.addEventListener("change", () => readTree(el.treeFile.files[0]));
    el.metadataFile.addEventListener("change", () => readMetadata(el.metadataFile.files[0]));
    el.geojsonFile.addEventListener("change", () => readCustomGeoJson(el.geojsonFile.files[0]));
    el.loadExample.addEventListener("click", loadExample);
    for (const node of [el.idColumn, el.latColumn, el.lonColumn, el.latLonColumn, el.locationColumn, el.dateColumn, el.colorColumn]) {
      node.addEventListener("change", () => {
        state.columnMap = readColumnMap();
        updateTreeCladeControl();
        reconcile();
      });
    }
    el.treeCladeDepth.addEventListener("input", () => {
      el.treeCladeDepthValue.value = `${el.treeCladeDepth.value}%`;
    });
    el.treeCladeDepth.addEventListener("change", () => {
      state.treeCladeDepth = Number(el.treeCladeDepth.value) / 100;
      reconcile();
    });
    el.searchBox.addEventListener("input", applyFilters);
    el.filterColumn.addEventListener("change", () => {
      state.filterColumn = el.filterColumn.value;
      refreshFilterValues();
      applyFilters();
    });
    el.filterValue.addEventListener("change", () => {
      state.filterValue = el.filterValue.value;
      applyFilters();
    });
    el.mappedOnly.addEventListener("change", applyFilters);
    el.closeDetail.addEventListener("click", () => selectGenome(""));
    el.exportGeojson.addEventListener("click", exportGeojson);
    el.exportSession.addEventListener("click", exportSession);
    el.globeView.addEventListener("click", () => setMapMode("globe"));
    el.flatView.addEventListener("click", () => setMapMode("flat"));
    el.usCountiesMap.addEventListener("click", () => loadBundledFlatGeoJson(US_COUNTIES_MAP_URL, "US counties", {
      minLon: -125,
      minLat: 24,
      maxLon: -66,
      maxLat: 50
    }));
    el.zoomIn.addEventListener("click", () => setMapZoom(state.mapZoom * 1.18));
    el.zoomOut.addEventListener("click", () => setMapZoom(state.mapZoom / 1.18));
    el.resetMap.addEventListener("click", resetMapView);
    el.mapSvg.addEventListener("pointerdown", startMapDrag);
    el.mapSvg.addEventListener("pointermove", moveMapDrag);
    el.mapSvg.addEventListener("pointerup", endMapDrag);
    el.mapSvg.addEventListener("pointercancel", endMapDrag);
    window.addEventListener("pointerup", endMapDrag);
    window.addEventListener("pointercancel", endMapDrag);
    el.mapSvg.addEventListener("click", clickMap);
    el.mapSvg.addEventListener("wheel", zoomMapWheel, { passive: false });
    el.mapSvg.addEventListener("dblclick", () => setMapZoom(state.mapZoom * 1.25));
    el.toggleControls.addEventListener("click", () => togglePanel("controls"));
    el.toggleDetails.addEventListener("click", () => togglePanel("details"));
    el.toggleTree.addEventListener("click", () => togglePanel("tree"));
    el.treeScroll.addEventListener("pointerdown", startTreeDrag);
    el.treeScroll.addEventListener("pointermove", moveTreeDrag);
    el.treeScroll.addEventListener("pointerup", endTreeDrag);
    el.treeScroll.addEventListener("pointercancel", endTreeDrag);
    el.midpointRootTree.addEventListener("click", midpointRootLoadedTree);
    el.originalRootTree.addEventListener("click", restoreOriginalTreeRoot);
  }

  function togglePanel(panel) {
    if (panel === "controls") state.controlsCollapsed = !state.controlsCollapsed;
    if (panel === "details") state.detailsCollapsed = !state.detailsCollapsed;
    if (panel === "tree") state.treeCollapsed = !state.treeCollapsed;
    applyPanelState();
    setTimeout(() => {
      drawMap();
      drawTree();
    }, 0);
  }

  function applyPanelState() {
    el.appShell.classList.toggle("controls-collapsed", state.controlsCollapsed);
    el.appShell.classList.toggle("details-collapsed", state.detailsCollapsed);
    el.appShell.classList.toggle("tree-collapsed", state.treeCollapsed);
    el.toggleControls.textContent = state.controlsCollapsed ? "›" : "‹";
    el.toggleControls.title = state.controlsCollapsed ? "Show controls" : "Hide controls";
    el.toggleDetails.textContent = state.detailsCollapsed ? "‹" : "›";
    el.toggleDetails.title = state.detailsCollapsed ? "Show metadata" : "Hide metadata";
    el.toggleTree.textContent = state.treeCollapsed ? "⌃" : "⌄";
    el.toggleTree.title = state.treeCollapsed ? "Show tree" : "Hide tree";
  }

  function setMapMode(mode) {
    state.mapMode = mode;
    state.mapZoom = clamp(state.mapZoom, 0.72, state.mapMode === "globe" ? MAX_GLOBE_ZOOM : MAX_FLAT_ZOOM);
    drawMap();
  }

  function setMapZoom(value) {
    state.mapZoom = clamp(value, 0.72, state.mapMode === "globe" ? MAX_GLOBE_ZOOM : MAX_FLAT_ZOOM);
    drawMap();
  }

  function resetMapView() {
    state.rotationLon = -40;
    state.rotationLat = 14;
    if (state.mapMode === "flat" && state.customBounds) {
      fitFlatBounds(state.customBounds);
    } else {
      state.mapZoom = 1;
      state.flatPanX = 0;
      state.flatPanY = 0;
    }
    drawMap();
  }

  function startMapDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.isPrimary === false) return;
    state.drag = {
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      moved: false
    };
  }

  function moveMapDrag(event) {
    if (!state.drag) return;
    const totalDistance = Math.hypot(
      event.clientX - state.drag.startX,
      event.clientY - state.drag.startY
    );
    if (!state.drag.moved && totalDistance <= 4) return;
    if (!state.drag.moved) {
      state.drag.moved = true;
      el.mapSvg.setPointerCapture?.(state.drag.pointerId);
      el.mapSvg.closest(".map-panel")?.classList.add("dragging");
    }
    const dx = event.clientX - state.drag.x;
    const dy = event.clientY - state.drag.y;
    state.drag.x = event.clientX;
    state.drag.y = event.clientY;
    if (state.mapMode === "globe") {
      state.rotationLon = wrapLongitude(state.rotationLon - dx / (2.4 * state.mapZoom));
      state.rotationLat = clamp(state.rotationLat + dy / (2.4 * state.mapZoom), -78, 78);
    } else {
      state.flatPanX += dx;
      state.flatPanY += dy;
    }
    scheduleMapDraw();
  }

  function endMapDrag(event) {
    if (!state.drag) return;
    const moved = state.drag.moved;
    if (moved && event.type === "pointerup") {
      state.ignoreMapClicksUntil = performance.now() + 250;
    }
    state.drag = null;
    if (moved && el.mapSvg.hasPointerCapture?.(event.pointerId)) {
      el.mapSvg.releasePointerCapture?.(event.pointerId);
    }
    el.mapSvg.closest(".map-panel")?.classList.remove("dragging");
    if (moved) scheduleMapDraw();
  }

  function scheduleMapDraw() {
    if (state.mapDrawFrame) return;
    state.mapDrawFrame = requestAnimationFrame(() => {
      state.mapDrawFrame = 0;
      drawMap();
    });
  }

  function zoomMapWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setMapZoom(state.mapZoom * factor);
  }

  function clickMap(event) {
    if (performance.now() < state.ignoreMapClicksUntil) return;
    const genomeId = event.target?.dataset?.genomeId;
    if (genomeId) selectGenome(genomeId);
  }

  function startTreeDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    state.treeDrag = {
      x: event.clientX,
      y: event.clientY,
      left: el.treeScroll.scrollLeft,
      top: el.treeScroll.scrollTop
    };
    el.treeScroll.setPointerCapture?.(event.pointerId);
    el.treeScroll.classList.add("dragging");
  }

  function moveTreeDrag(event) {
    if (!state.treeDrag) return;
    event.preventDefault();
    el.treeScroll.scrollLeft = state.treeDrag.left - (event.clientX - state.treeDrag.x);
    el.treeScroll.scrollTop = state.treeDrag.top - (event.clientY - state.treeDrag.y);
  }

  function endTreeDrag(event) {
    if (!state.treeDrag) return;
    state.treeDrag = null;
    el.treeScroll.releasePointerCapture?.(event.pointerId);
    el.treeScroll.classList.remove("dragging");
  }

  async function loadWorldMap() {
    try {
      const response = await fetch(WORLD_MAP_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const collection = await response.json();
      state.worldFeatures = Array.isArray(collection.features) ? collection.features : [];
      state.worldRings = state.worldFeatures.flatMap(featureRings);
      state.worldGlobeRings = state.worldRings.map(simplifyGlobeRing);
      state.worldMapLoaded = state.worldRings.length > 0;
      drawMap();
    } catch (error) {
      state.worldMapLoaded = false;
      setStatus(`Using fallback basemap; serve locally for detailed geography (${error.message}).`);
      drawMap();
    }
  }

  async function readMlvamapsExport(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus(`Inspecting ${files.length} files in the selected MLVAmaps export.`);
    try {
      const candidates = mlvamapsExportCandidates(files);
      if (!candidates.length) {
        throw new Error(
          "no complete export pair found; expected mlva_nj.tree with myoga_metadata.tsv " +
          "or combined_marker_nj.tree with combined_marker_metadata.tsv"
        );
      }
      const loaded = [];
      const failures = [];
      for (const candidate of candidates) {
        try {
          const [treeText, metadataText] = await Promise.all([
            candidate.treeFile.text(),
            candidate.metadataFile.text()
          ]);
          const treeRoot = parseNewick(treeText.trim());
          const treeTips = flattenTips(treeRoot);
          const metadata = parseTable(metadataText);
          if (!treeTips.length) throw new Error("tree has no named tips");
          if (!bestColumn(metadata.headers, ID_COLUMNS)) {
            throw new Error("metadata has no recognized sample identifier column");
          }
          loaded.push({ ...candidate, treeText, treeRoot, treeTips, metadata });
        } catch (error) {
          failures.push(`${candidate.label}: ${error.message}`);
        }
      }
      if (!loaded.length) throw new Error(failures.join("; "));

      loaded.sort((left, right) => {
        const tipDifference = right.treeTips.length - left.treeTips.length;
        if (tipDifference) return tipDifference;
        return Number(right.kind === "combined") - Number(left.kind === "combined");
      });
      const selected = loaded[0];
      state.ggrIds = new Set();
      state.treeText = selected.treeText;
      state.treeRoot = selected.treeRoot;
      state.treeTips = selected.treeTips;
      state.metadata = selected.metadata;
      setDatasetSource("mlvamaps", selected.label);
      guessColumns();
      populateColumnControls();
      reconcile();
      const alternate = loaded.length > 1
        ? ` The ${loaded[1].label} is also present (${loaded[1].treeTips.length} tips).`
        : "";
      setStatus(
        `Loaded ${selected.label} from the MLVAmaps export: ` +
        `${selected.treeTips.length} tree tips and ${selected.metadata.rows.length} metadata rows.${alternate}`
      );
    } catch (error) {
      setStatus(`MLVAmaps export failed: ${error.message}`);
    }
  }

  function mlvamapsExportCandidates(files) {
    const byName = new Map();
    for (const file of files) {
      const name = String(file.name || "").toLowerCase();
      if (name && !byName.has(name)) byName.set(name, file);
    }
    return [
      {
        kind: "combined",
        label: "MLVAmaps combined-marker tree",
        treeFile: byName.get("combined_marker_nj.tree"),
        metadataFile: byName.get("combined_marker_metadata.tsv")
      },
      {
        kind: "mlva",
        label: "MLVAmaps MLVA tree",
        treeFile: byName.get("mlva_nj.tree"),
        metadataFile: byName.get("myoga_metadata.tsv")
      }
    ].filter((candidate) => candidate.treeFile && candidate.metadataFile);
  }

  function setDatasetSource(kind, label) {
    state.datasetKind = kind;
    state.datasetLabel = label;
    el.treeHeading.textContent = label;
  }

  function mlvamapsTreeLabel(fileName) {
    const name = String(fileName || "").toLowerCase();
    if (name === "combined_marker_nj.tree") return "MLVAmaps combined-marker tree";
    if (name === "mlva_nj.tree") return "MLVAmaps MLVA tree";
    return "";
  }

  async function readGgr(file) {
    if (!file) return;
    setStatus(`Reading ${file.name} locally.`);
    const buffer = await file.arrayBuffer();
    state.ggrIds = extractGgrIds(new Uint8Array(buffer));
    setDatasetSource("parsnp", "Parsnp phylogeny");
    setStatus(`Read ${file.name}; extracted ${state.ggrIds.size} possible genome labels.`);
    reconcile();
  }

  async function readTree(file) {
    if (!file) return;
    setStatus(`Reading ${file.name} locally.`);
    state.treeText = await file.text();
    const mlvamapsLabel = mlvamapsTreeLabel(file.name);
    if (mlvamapsLabel) {
      state.ggrIds = new Set();
      setDatasetSource("mlvamaps", mlvamapsLabel);
    } else if (state.ggrIds.size) {
      setDatasetSource("parsnp", "Parsnp phylogeny");
    } else {
      setDatasetSource("generic", "relatedness tree");
    }
    loadTreeText(state.treeText);
  }

  async function readMetadata(file) {
    if (!file) return;
    setStatus(`Reading ${file.name} locally.`);
    if (
      state.datasetKind === "generic" &&
      ["myoga_metadata.tsv", "combined_marker_metadata.tsv"].includes(file.name.toLowerCase())
    ) {
      setDatasetSource("mlvamaps", "MLVAmaps relatedness tree");
    }
    loadMetadataText(await file.text());
  }

  async function readCustomGeoJson(file) {
    if (!file) return;
    setStatus(`Reading ${file.name} locally.`);
    try {
      const collection = JSON.parse(await file.text());
      const rings = geoJsonRings(collection);
      const bounds = boundsForRings(rings);
      if (!rings.length || !bounds) throw new Error("no Polygon or MultiPolygon coordinates found");
      state.customMapName = file.name;
      state.customRings = rings;
      state.customBounds = bounds;
      state.mapMode = "flat";
      fitFlatBounds(bounds);
      drawMap();
      setStatus(`Loaded custom flat GeoJSON map ${file.name} with ${rings.length} polygon rings.`);
    } catch (error) {
      setStatus(`Custom GeoJSON failed: ${error.message}`);
    }
  }

  async function loadBundledFlatGeoJson(url, label, preferredBounds) {
    setStatus(`Loading bundled ${label} GeoJSON.`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const collection = await response.json();
      const rings = geoJsonRings(collection);
      const bounds = boundsForRings(rings);
      if (!rings.length || !bounds) throw new Error("no Polygon or MultiPolygon coordinates found");
      state.customMapName = label;
      state.customRings = rings;
      state.customBounds = preferredBounds || bounds;
      state.mapMode = "flat";
      fitFlatBounds(bounds);
      drawMap();
      setStatus(`Loaded bundled ${label} flat map with ${rings.length} polygon rings.`);
    } catch (error) {
      setStatus(`Bundled ${label} GeoJSON failed: ${error.message}`);
    }
  }

  function loadTreeText(text) {
    try {
      const firstTree = !state.treeRoot;
      state.treeRoot = parseNewick(text.trim());
      state.treeTips = flattenTips(state.treeRoot);
      if (firstTree && state.metadata.headers.length) {
        state.columnMap.color = TREE_CLADE_COLOR;
        el.colorColumn.value = TREE_CLADE_COLOR;
        updateTreeCladeControl();
      }
      setStatus(`Parsed ${state.treeTips.length} tree tips.`);
      reconcile();
    } catch (error) {
      setStatus(`Tree parse failed: ${error.message}`);
    }
  }

  function midpointRootLoadedTree() {
    if (!state.treeText.trim()) {
      setStatus("Load a tree before midpoint rooting.");
      return;
    }
    try {
      state.treeRoot = midpointRootTree(parseNewick(state.treeText.trim()));
      state.treeTips = flattenTips(state.treeRoot);
      reconcile();
      setStatus(`Midpoint-rooted tree with ${state.treeTips.length} tips.`);
    } catch (error) {
      setStatus(`Midpoint rooting failed: ${error.message}`);
    }
  }

  function restoreOriginalTreeRoot() {
    if (!state.treeText.trim()) {
      setStatus("Load a tree before restoring the original root.");
      return;
    }
    loadTreeText(state.treeText);
    setStatus("Restored original tree root.");
  }

  function loadMetadataText(text) {
    try {
      state.metadata = parseTable(text);
      guessColumns();
      populateColumnControls();
      reconcile();
      setStatus(`Loaded ${state.metadata.rows.length} metadata rows.`);
    } catch (error) {
      setStatus(`Metadata parse failed: ${error.message}`);
    }
  }

  async function loadExample() {
    try {
      setDatasetSource("parsnp", "Parsnp phylogeny");
      const [ggrResponse, treeResponse, metadataResponse] = await Promise.all([
        fetch("example/mers49/parsnp.ggr"),
        fetch("example/mers49/parsnp.tree"),
        fetch("example/mers49/metadata.csv")
      ]);
      if (!ggrResponse.ok || !treeResponse.ok || !metadataResponse.ok) throw new Error("repo example files unavailable");
      state.ggrIds = extractGgrIds(new Uint8Array(await ggrResponse.arrayBuffer()));
      loadTreeText(await treeResponse.text());
      loadMetadataText(await metadataResponse.text());
      setStatus("Loaded example Parsnp tree, GGR, and dummy metadata from the repo.");
    } catch (error) {
      loadTinyExample();
      setStatus(`Loaded built-in tiny example; repo example unavailable (${error.message}).`);
    }
  }

  function loadTinyExample() {
    setDatasetSource("parsnp", "Parsnp phylogeny");
    state.ggrIds = new Set(["sample_a", "sample_b", "sample_c", "sample_d", "reference_1"].map(canonicalId));
    loadTreeText("((sample_a:0.02,sample_b:0.03):0.01,(sample_c:0.04,(sample_d:0.02,reference_1:0.05):0.02):0.01);");
    loadMetadataText([
      "genome_id,collection_date,host,source,country,lat,lon,lineage,notes",
      "sample_a,2026-03-12,human,clinical,United States,40.71,-74.00,L1,initial case",
      "sample_b,2026-03-14,human,clinical,United States,40.73,-73.94,L1,household contact",
      "sample_c,2026-03-20,environment,wastewater,United Kingdom,51.50,-0.12,L2,travel context",
      "sample_d,2026-03-22,human,clinical,Brazil,-23.55,-46.63,L2,airport screen",
      "reference_1,2025-11-01,unknown,reference,France,48.85,2.35,L3,public reference"
    ].join("\n"));
  }

  function guessColumns() {
    const headers = state.metadata.headers;
    state.columnMap = {
      id: bestColumn(headers, ID_COLUMNS),
      lat: bestColumn(headers, LAT_COLUMNS),
      lon: bestColumn(headers, LON_COLUMNS),
      latLon: bestColumn(headers, LAT_LON_COLUMNS),
      location: bestColumn(headers, LOCATION_COLUMNS),
      date: bestColumn(headers, DATE_COLUMNS),
      color: state.treeRoot
        ? TREE_CLADE_COLOR
        : bestColumn(headers, ["lineage", "cluster", "clade", "host", "source", "sample_type", "country"]) || ""
    };
  }

  function populateColumnControls() {
    const headers = state.metadata.headers;
    fillSelect(el.idColumn, headers, state.columnMap.id, false);
    fillSelect(el.latColumn, headers, state.columnMap.lat, true);
    fillSelect(el.lonColumn, headers, state.columnMap.lon, true);
    fillSelect(el.latLonColumn, headers, state.columnMap.latLon, true);
    fillSelect(el.locationColumn, headers, state.columnMap.location, true);
    fillSelect(el.dateColumn, headers, state.columnMap.date, true);
    fillSelect(el.colorColumn, headers, state.columnMap.color, true);
    el.colorColumn.insertBefore(new Option("Tree distance clades", TREE_CLADE_COLOR), el.colorColumn.firstChild);
    if (state.columnMap.color === TREE_CLADE_COLOR) el.colorColumn.value = TREE_CLADE_COLOR;
    fillSelect(el.filterColumn, headers, state.filterColumn, true);
    el.treeCladeDepth.value = String(Math.round(state.treeCladeDepth * 100));
    updateTreeCladeControl();
  }

  function fillSelect(select, values, selected, allowBlank) {
    select.textContent = "";
    if (allowBlank) select.append(new Option("None", ""));
    for (const value of values) select.append(new Option(value, value));
    select.value = selected && values.includes(selected) ? selected : "";
  }

  function readColumnMap() {
    return {
      id: el.idColumn.value,
      lat: el.latColumn.value,
      lon: el.lonColumn.value,
      latLon: el.latLonColumn.value,
      location: el.locationColumn.value,
      date: el.dateColumn.value,
      color: el.colorColumn.value
    };
  }

  function updateTreeCladeControl() {
    const active = el.colorColumn.value === TREE_CLADE_COLOR && Boolean(state.treeRoot);
    el.treeCladeControl.hidden = !active;
    const cladeCount = unique(state.genomes
      .map((genome) => genome.colorValue)
      .filter((value) => value.startsWith(TREE_CLADE_PREFIX) && value !== TREE_CLADE_UNMATCHED)).length;
    el.treeCladeDepthValue.value = active && cladeCount
      ? `${Math.round(state.treeCladeDepth * 100)}% · ${cladeCount} clades`
      : `${Math.round(state.treeCladeDepth * 100)}%`;
  }

  function reconcile() {
    if (!state.treeTips.length && !state.metadata.rows.length) {
      updateStats();
      drawMap();
      drawTree();
      return;
    }
    if (state.metadata.headers.length) {
      state.columnMap = readColumnMap();
    }

    const metadataById = new Map();
    const idColumn = state.columnMap.id;
    for (const row of state.metadata.rows) {
      const value = idColumn ? row[idColumn] : "";
      for (const key of idVariants(value)) {
        if (!metadataById.has(key)) metadataById.set(key, row);
      }
    }

    const tips = state.treeTips.length ? state.treeTips : rowsAsTips();
    const treeClades = state.columnMap.color === TREE_CLADE_COLOR && state.treeRoot
      ? treeCladeAssignments(state.treeRoot, state.treeCladeDepth)
      : new Map();
    const usedRows = new Set();
    state.genomes = tips.map((tip, index) => {
      const row = matchRow(tip.name, metadataById);
      if (row) usedRows.add(row);
      return buildGenome(tip, row, index, false, treeClades.get(tip.name));
    });

    if (!state.treeTips.length) {
      state.genomes = state.metadata.rows.map((row, index) => buildGenome({ name: row[idColumn] || `row_${index + 1}` }, row, index));
    }

    const extraRows = state.metadata.rows.filter((row) => !usedRows.has(row));
    for (const row of extraRows) {
      state.genomes.push(buildGenome({ name: row[idColumn] || `metadata_${state.genomes.length + 1}` }, row, state.genomes.length, true));
    }

    updateTreeCladeControl();
    refreshFilterValues();
    applyFilters();
  }

  function rowsAsTips() {
    const idColumn = state.columnMap.id;
    return state.metadata.rows.map((row, index) => ({ name: row[idColumn] || `row_${index + 1}` }));
  }

  function matchRow(name, metadataById) {
    for (const key of idVariants(name)) {
      if (metadataById.has(key)) return metadataById.get(key);
    }
    return null;
  }

  function buildGenome(tip, row, index, metadataOnly, treeClade) {
    const name = cleanLabel(tip.name || `genome_${index + 1}`);
    const id = canonicalId(name) || `genome_${index + 1}`;
    const coords = coordinatesFor(row || {});
    const colorValue = state.columnMap.color === TREE_CLADE_COLOR
      ? treeClade || TREE_CLADE_UNMATCHED
      : state.columnMap.color && row ? cleanValue(row[state.columnMap.color]) : "";
    const dateValue = state.columnMap.date && row ? cleanValue(row[state.columnMap.date]) : "";
    return {
      id,
      label: name,
      tipName: tip.name || name,
      index,
      row: row || {},
      metadataOnly: Boolean(metadataOnly),
      inTree: !metadataOnly && state.treeTips.length > 0,
      inGgr: idInSet(name, state.ggrIds),
      matchedMetadata: Boolean(row),
      longitude: coords ? coords.longitude : null,
      latitude: coords ? coords.latitude : null,
      coordinateSource: coords ? coords.source : "",
      isCentroid: coords ? coords.centroid : false,
      location: coords ? coords.location : "",
      colorValue,
      dateValue
    };
  }

  function coordinatesFor(row) {
    const latCol = state.columnMap.lat;
    const lonCol = state.columnMap.lon;
    const latLonCol = state.columnMap.latLon;
    const locationCol = state.columnMap.location;
    const lat = latCol ? parseNumber(row[latCol]) : null;
    const lon = lonCol ? parseNumber(row[lonCol]) : null;
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { latitude: lat, longitude: lon, source: "exact", centroid: false, location: locationCol ? cleanValue(row[locationCol]) : "" };
    }
    if (latLonCol) {
      const parsed = parseLatLon(row[latLonCol]);
      if (parsed) return { latitude: parsed.latitude, longitude: parsed.longitude, source: "exact", centroid: false, location: cleanValue(row[latLonCol]) };
    }
    const location = locationCol ? cleanValue(row[locationCol]) : "";
    const centroid = countryCentroid(location);
    if (centroid) {
      return { latitude: centroid[1], longitude: centroid[0], source: "country", centroid: true, location };
    }
    return null;
  }

  function applyFilters() {
    const query = el.searchBox.value.trim().toLowerCase();
    const mappedOnly = el.mappedOnly.checked;
    const filterColumn = el.filterColumn.value;
    const filterValue = el.filterValue.value;
    state.filterColumn = filterColumn;
    state.filterValue = filterValue;
    state.colorColumn = state.columnMap.color;
    state.filtered = state.genomes.filter((genome) => {
      if (mappedOnly && !isMapped(genome)) return false;
      if (filterColumn && filterValue && cleanValue(genome.row[filterColumn]) !== filterValue) return false;
      if (!query) return true;
      return [genome.label, genome.location, genome.colorValue, genome.dateValue, ...Object.values(genome.row)].some((value) => cleanValue(value).toLowerCase().includes(query));
    });
    updateStats();
    drawMap();
    drawTree();
    if (state.selectedId && !state.filtered.some((genome) => genome.id === state.selectedId)) selectGenome("");
  }

  function refreshFilterValues() {
    const column = el.filterColumn.value;
    const current = el.filterValue.value;
    el.filterValue.textContent = "";
    el.filterValue.append(new Option("All", ""));
    if (!column) return;
    const values = unique(state.genomes.map((genome) => cleanValue(genome.row[column])).filter(Boolean)).slice(0, 500);
    for (const value of values) el.filterValue.append(new Option(value, value));
    el.filterValue.value = values.includes(current) ? current : "";
  }

  function updateStats() {
    el.treeCount.textContent = String(state.treeTips.length);
    el.metadataCount.textContent = String(state.metadata.rows.length);
    el.mappedCount.textContent = String(state.genomes.filter(isMapped).length);
    el.unmatchedCount.textContent = String(state.genomes.filter((genome) => !genome.matchedMetadata).length);
    el.treeStatus.textContent = state.treeTips.length ? `${state.filtered.filter((genome) => genome.inTree).length} tips in view` : "waiting for Newick";
  }

  function drawMap() {
    el.mapSvg.textContent = "";
    el.globeView.classList.toggle("active", state.mapMode === "globe");
    el.flatView.classList.toggle("active", state.mapMode === "flat");
    el.usCountiesMap.classList.toggle("active", state.mapMode === "flat" && state.customMapName === "US counties");
    const background = svg("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
    el.mapSvg.append(background);
    if (state.mapMode === "globe") drawGlobeShell();
    drawGraticule();
    drawLand();

    const mapped = state.filtered.filter(isMapped);
    const visible = drawMapPoints(mapped);
    const zoomLabel = `${state.mapZoom.toFixed(1)}×`;
    el.mapTitle.textContent = state.mapMode === "globe"
      ? `${visible} visible / ${mapped.length} mapped samples · ${zoomLabel}`
      : `${mapped.length} mapped samples${state.customMapName ? ` · ${state.customMapName}` : ""} · ${zoomLabel}`;

    if (!mapped.length) {
      const text = svg("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "map-label" }, "No map-ready coordinates in view");
      el.mapSvg.append(text);
    } else if (!visible && state.mapMode === "globe") {
      const text = svg("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "map-label" }, "Rotate the globe to bring mapped samples into view");
      el.mapSvg.append(text);
    }
  }

  function drawMapPoints(mapped) {
    let visible = 0;
    const buckets = new Map();
    const pointClouds = new Map();
    for (const genome of mapped) {
      const point = project(genome.longitude, genome.latitude);
      if (!point.visible) continue;
      visible += 1;
      const key = `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      const count = buckets.get(key) || 0;
      buckets.set(key, count + 1);
      const jitter = jitterFor(genome.id, count);
      const x = point.x + jitter.x;
      const y = point.y + jitter.y;
      const color = colorFor(genome.colorValue || genome.label);
      if (state.drag?.moved) {
        const radius = 4.5 * point.scale;
        const path = pointClouds.get(color) || [];
        path.push(
          `M ${x - radius} ${y} ` +
          `a ${radius} ${radius} 0 1 0 ${radius * 2} 0 ` +
          `a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
        );
        pointClouds.set(color, path);
        continue;
      }
      const circle = svg("circle", {
        cx: x,
        cy: y,
        r: (genome.id === state.selectedId ? 7 : 5.5) * point.scale,
        fill: color,
        "data-genome-id": genome.id,
        class: ["map-point", genome.isCentroid ? "centroid" : "", genome.matchedMetadata ? "" : "unmatched", genome.id === state.selectedId ? "selected" : ""].join(" ")
      });
      circle.append(svg("title", {}, `${genome.label}\n${genome.location || "No location label"}`));
      el.mapSvg.append(circle);
    }
    for (const [color, commands] of pointClouds) {
      el.mapSvg.append(svg("path", { d: commands.join(" "), fill: color, class: "map-point-cloud" }));
    }
    return visible;
  }

  function drawGlobeShell() {
    const view = globeView();
    el.mapSvg.append(svg("circle", { cx: W / 2, cy: H / 2, r: view.radius, class: "globe-ocean" }));
  }

  function drawGraticule() {
    if (state.mapMode === "flat" && state.customRings.length) return;
    if (state.mapMode === "flat") {
      for (let lon = -180; lon <= 180; lon += 30) {
        const a = project(lon, -85);
        const b = project(lon, 85);
        el.mapSvg.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "graticule" }));
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const a = project(-180, lat);
        const b = project(180, lat);
        el.mapSvg.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "graticule" }));
      }
      return;
    }
    const lines = [];
    for (let lon = -180; lon <= 180; lon += 30) lines.push(range(-85, 85, 3).map((lat) => [lon, lat]));
    for (let lat = -60; lat <= 60; lat += 30) {
      lines.push(range(-180, 180, 3).map((lon) => [lon, lat]));
    }
    drawProjectedLines(lines, "graticule");
  }

  function drawLand() {
    if (state.mapMode === "globe" && state.drag?.moved) {
      drawFallbackGlobeLand();
      return;
    }
    if ((state.mapMode === "flat" && state.customRings.length) || state.worldMapLoaded) {
      drawGeoJsonLand();
      return;
    }
    if (state.mapMode === "flat") {
      for (const polygon of LAND) {
        el.mapSvg.append(svg("polygon", { points: polygon.map(([lon, lat]) => {
          const point = project(lon, lat);
          return `${point.x},${point.y}`;
        }).join(" "), class: "land" }));
      }
      return;
    }
    drawFallbackGlobeLand();
  }

  function drawFallbackGlobeLand() {
    drawProjectedLines(LAND.map((polygon) => densifyPolygon(polygon, 4)), "land-line");
    const view = globeView();
    el.mapSvg.append(svg("circle", { cx: W / 2, cy: H / 2, r: view.radius, class: "globe-rim" }));
  }

  function drawGeoJsonLand() {
    if (state.mapMode === "flat") {
      const rings = state.customRings.length ? state.customRings : state.worldRings;
      for (const ring of rings) {
        const path = ring.map(([lon, lat]) => {
          const point = project(lon, lat);
          return `${point.x},${point.y}`;
        }).join(" ");
        if (path) el.mapSvg.append(svg("polygon", { points: path, class: ["land country-fill", state.customRings.length ? "custom-geojson-fill" : ""].join(" ") }));
      }
      return;
    }
    drawProjectedLines(state.worldGlobeRings, "land-line country-line");
    const view = globeView();
    el.mapSvg.append(svg("circle", { cx: W / 2, cy: H / 2, r: view.radius, class: "globe-rim" }));
  }

  function featureRings(feature) {
    const geometry = feature.geometry || {};
    if (geometry.type === "Polygon") return geometry.coordinates.map(sanitizeRing);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map(sanitizeRing));
    return [];
  }

  function geoJsonRings(collection) {
    if (collection?.type === "FeatureCollection") return (collection.features || []).flatMap(featureRings);
    if (collection?.type === "Feature") return featureRings(collection);
    if (collection?.type === "Polygon" || collection?.type === "MultiPolygon") return featureRings({ geometry: collection });
    return [];
  }

  function sanitizeRing(ring) {
    return ring
      .filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point) => [Number(point[0]), Number(point[1])])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  }

  function simplifyGlobeRing(ring) {
    if (ring.length <= 4) return ring;
    const tolerance = 0.25;
    const simplified = [ring[0]];
    let previous = ring[0];
    for (let index = 1; index < ring.length - 1; index += 1) {
      const point = ring[index];
      const lonDistance = Math.abs(wrapLongitude(point[0] - previous[0]));
      const latDistance = Math.abs(point[1] - previous[1]);
      if (Math.max(lonDistance, latDistance) < tolerance) continue;
      simplified.push(point);
      previous = point;
    }
    simplified.push(ring[ring.length - 1]);
    return simplified.length >= 4 ? simplified : ring;
  }

  function boundsForRings(rings) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
    }
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
    if (minLon === maxLon || minLat === maxLat) return null;
    return { minLon, minLat, maxLon, maxLat };
  }

  function fitFlatBounds(bounds) {
    state.mapZoom = 1;
    state.flatPanX = 0;
    state.flatPanY = 0;
  }

  function flatFit(bounds = flatBounds()) {
    const padding = 38;
    const width = Math.max(0.000001, bounds.maxLon - bounds.minLon);
    const height = Math.max(0.000001, bounds.maxLat - bounds.minLat);
    const scale = Math.min((W - padding * 2) / width, (H - padding * 2) / height);
    const projectedWidth = width * scale;
    const projectedHeight = height * scale;
    return {
      bounds,
      padding,
      scale,
      offsetX: (W - projectedWidth) / 2,
      offsetY: (H - projectedHeight) / 2
    };
  }

  function flatBounds() {
    return state.customRings.length && state.customBounds
      ? state.customBounds
      : { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 };
  }

  function drawProjectedLines(lines, className) {
    const commands = [];
    for (const points of lines) {
      let drawing = false;
      for (const [lon, lat] of points) {
        const projected = project(lon, lat);
        if (projected.visible) {
          commands.push(`${drawing ? "L" : "M"} ${projected.x} ${projected.y}`);
          drawing = true;
        } else {
          drawing = false;
        }
      }
    }
    if (commands.length) el.mapSvg.append(svg("path", { d: commands.join(" "), class: className }));
  }

  function drawTree() {
    el.treeSvg.textContent = "";
    if (!state.treeRoot) {
      el.treeSvg.append(svg("text", { x: 24, y: 42, class: "tree-label" }, "Load an MLVAmaps export or Newick tree to begin."));
      return;
    }
    const leaves = flattenTips(state.treeRoot);
    const visibleByTip = new Map(state.filtered.map((genome) => [genome.tipName, genome]));
    const genomeByTip = new Map(state.genomes.filter((genome) => genome.inTree).map((genome) => [genome.tipName, genome]));
    const cladeByNode = new Map();
    function resolveBranchClade(node) {
      if (!node.children.length) {
        const value = genomeByTip.get(node.name)?.colorValue || "";
        const clade = state.columnMap.color === TREE_CLADE_COLOR && value !== TREE_CLADE_UNMATCHED ? value : "";
        cladeByNode.set(node, clade);
        return clade;
      }
      const childClades = node.children.map(resolveBranchClade);
      const clade = childClades.length && childClades[0] && childClades.every((value) => value === childClades[0])
        ? childClades[0]
        : "";
      cladeByNode.set(node, clade);
      return clade;
    }
    resolveBranchClade(state.treeRoot);
    const rowHeight = 22;
    const left = 18;
    const top = 18;
    const maxLabelLength = leaves.reduce((length, leaf) => Math.max(length, cleanLabel(leaf.name).length), 0);
    const visibleWidth = el.treeScroll.clientWidth || el.treeSvg.clientWidth || 720;
    const labelWidth = Math.min(620, Math.max(180, maxLabelLength * 6.6));
    const treeWidth = Math.max(visibleWidth * 1.45, 980, Math.min(2600, leaves.length * 32));
    const width = Math.max(visibleWidth, left + treeWidth + labelWidth + 50);
    const height = Math.max(120, leaves.length * rowHeight + top * 2);
    el.treeSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    el.treeSvg.setAttribute("width", String(width));
    el.treeSvg.setAttribute("height", String(height));
    el.treeSvg.style.width = `${width}px`;
    el.treeSvg.style.minHeight = `${height}px`;

    assignTreeCoordinates(state.treeRoot, leaves, left, left + treeWidth, top, rowHeight);
    el.treeSvg.append(svg("line", { x1: left + treeWidth + 6, y1: 0, x2: left + treeWidth + 6, y2: height, class: "tree-label-guide" }));
    for (const node of walkTree(state.treeRoot)) {
      if (!node.children.length) continue;
      for (const child of node.children) {
        const edge = svg("path", { d: `M ${node.x} ${child.y} L ${child.x} ${child.y} M ${node.x} ${node.y} L ${node.x} ${child.y}`, class: "tree-edge" });
        const clade = cladeByNode.get(child);
        if (clade) edge.style.stroke = colorFor(clade);
        el.treeSvg.append(edge);
      }
    }
    for (const leaf of leaves) {
      const genome = visibleByTip.get(leaf.name) || genomeByTip.get(leaf.name);
      const mapped = genome && isMapped(genome);
      const dot = svg("circle", {
        cx: leaf.x,
        cy: leaf.y,
        r: genome && genome.id === state.selectedId ? 5 : 3.5,
        fill: genome ? colorFor(genome.colorValue || genome.label) : "#93a29a",
        class: "tree-node-dot"
      });
      const label = svg("text", {
        x: leaf.x + 8,
        y: leaf.y + 3,
        class: ["tree-label", mapped ? "mapped" : "", genome && genome.id === state.selectedId ? "selected" : ""].join(" ")
      }, cleanLabel(leaf.name));
      if (genome) {
        dot.addEventListener("click", () => selectGenome(genome.id));
        label.addEventListener("click", () => selectGenome(genome.id));
      }
      el.treeSvg.append(dot, label);
    }
  }

  function selectGenome(id) {
    state.selectedId = id;
    const genome = state.genomes.find((item) => item.id === id);
    el.detailEmpty.hidden = Boolean(genome);
    el.detailContent.hidden = !genome;
    if (!genome) {
      drawMap();
      drawTree();
      return;
    }
    el.detailSource.textContent = genome.metadataOnly
      ? "METADATA ONLY"
      : `${state.datasetLabel} sample`.toUpperCase();
    el.detailTitle.textContent = genome.label;
    el.detailSubtitle.textContent = genome.location || genome.colorValue || "No location metadata";
    const basics = [
      ["Tree", genome.inTree ? "present" : "not present"],
      ["Coordinates", isMapped(genome) ? `${genome.latitude.toFixed(5)}, ${genome.longitude.toFixed(5)}` : "not mapped"],
      ["Precision", genome.isCentroid ? "country centroid" : (genome.coordinateSource || "unknown")],
      ["Date", genome.dateValue || "unknown"],
      ["Color", genome.colorValue || "unassigned"]
    ];
    if (state.datasetKind === "parsnp" || state.ggrIds.size) {
      basics.splice(1, 0, ["GGR", genome.inGgr ? "matched" : state.ggrIds.size ? "not matched" : "not loaded"]);
    }
    el.detailBasics.textContent = "";
    for (const [key, value] of basics) {
      const item = document.createElement("div");
      item.append(html("dt", key), html("dd", value));
      el.detailBasics.append(item);
    }
    el.metadataTable.textContent = "";
    const entries = Object.entries(genome.row).filter(([, value]) => cleanValue(value));
    if (!entries.length) {
      el.metadataTable.append(html("div", "No matching metadata row.", "metadata-row"));
    } else {
      for (const [key, value] of entries) {
        const row = html("div", "", "metadata-row");
        row.append(html("span", key), html("span", cleanValue(value)));
        el.metadataTable.append(row);
      }
    }
    drawMap();
    drawTree();
  }

  function exportGeojson() {
    const features = state.filtered.filter(isMapped).map((genome) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [genome.longitude, genome.latitude] },
      properties: {
        sample_id: genome.label,
        genome_id: genome.label,
        dataset_source: state.datasetLabel,
        in_tree: genome.inTree,
        in_ggr: genome.inGgr,
        coordinate_source: genome.coordinateSource,
        geometry_is_centroid: genome.isCentroid,
        color_value: genome.colorValue,
        metadata: genome.row
      }
    }));
    download("myoga-genomes.geojson", JSON.stringify({ type: "FeatureCollection", features }, null, 2), "application/geo+json");
  }

  function exportSession() {
    const payload = {
      generated_by: "myoga",
      dataset_kind: state.datasetKind,
      dataset_source: state.datasetLabel,
      tree_clade_depth: state.treeCladeDepth,
      tree_tips: state.treeTips.map((tip) => tip.name),
      ggr_ids: Array.from(state.ggrIds),
      columns: state.columnMap,
      genomes: state.genomes
    };
    download("myoga-session.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function parseTable(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) throw new Error("empty metadata file");
    const delimiter = detectDelimiter(lines[0]);
    const headers = splitDelimited(lines[0], delimiter).map((header) => header.trim());
    const rows = lines.slice(1).map((line) => {
      const values = splitDelimited(line, delimiter);
      const row = {};
      headers.forEach((header, index) => { row[header] = values[index] === undefined ? "" : values[index].trim(); });
      return row;
    });
    return { headers, rows };
  }

  function detectDelimiter(line) {
    const candidates = ["\t", ",", ";"];
    return candidates.map((delimiter) => [delimiter, splitDelimited(line, delimiter).length]).sort((a, b) => b[1] - a[1])[0][0];
  }

  function splitDelimited(line, delimiter) {
    const values = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  function parseNewick(text) {
    let index = 0;
    function parseNode() {
      const node = { name: "", length: 0, children: [], parent: null, x: 0, y: 0 };
      if (text[index] === "(") {
        index += 1;
        while (index < text.length) {
          const child = parseNode();
          child.parent = node;
          node.children.push(child);
          if (text[index] === ",") {
            index += 1;
            continue;
          }
          if (text[index] === ")") {
            index += 1;
            break;
          }
        }
      }
      node.name = readName();
      if (text[index] === ":") {
        index += 1;
        const lengthText = readUntil(",();");
        node.length = Number.parseFloat(lengthText) || 0;
      }
      return node;
    }
    function readName() {
      while (/\s/.test(text[index] || "")) index += 1;
      if (text[index] === "'" || text[index] === '"') {
        const quote = text[index];
        index += 1;
        let value = "";
        while (index < text.length) {
          if (text[index] === quote) {
            if (text[index + 1] === quote) {
              value += quote;
              index += 2;
              continue;
            }
            index += 1;
            return value;
          }
          value += text[index];
          index += 1;
        }
        throw new Error("unterminated quoted Newick label");
      }
      return readUntil(":,();").trim();
    }
    function readUntil(chars) {
      let value = "";
      while (index < text.length && !chars.includes(text[index])) {
        value += text[index];
        index += 1;
      }
      return value.trim();
    }
    const root = parseNode();
    if (!root.children.length && !root.name) throw new Error("no Newick nodes found");
    return root;
  }

  function flattenTips(root) {
    return walkTree(root).filter((node) => !node.children.length && cleanLabel(node.name));
  }

  function walkTree(root) {
    const nodes = [];
    (function visit(node) {
      nodes.push(node);
      for (const child of node.children) visit(child);
    })(root);
    return nodes;
  }

  function assignTreeCoordinates(root, leaves, left, right, top, rowHeight) {
    const totals = cumulativeLengths(root);
    const max = Math.max(...totals.map((item) => item.total), 1);
    leaves.forEach((leaf, index) => { leaf.y = top + index * rowHeight; });
    for (const item of totals) {
      const fraction = item.total <= 0 ? 0 : Math.pow(item.total / max, 0.58);
      item.node.x = left + fraction * (right - left);
    }
    function setInternalY(node) {
      if (!node.children.length) return node.y;
      node.y = node.children.map(setInternalY).reduce((a, b) => a + b, 0) / node.children.length;
      return node.y;
    }
    setInternalY(root);
  }

  function cumulativeLengths(root) {
    const result = [];
    function visit(node, total, depth) {
      const next = total + (node.parent ? branchLength(node) : 0);
      result.push({ node, total: next || depth });
      for (const child of node.children) visit(child, next, depth + 1);
    }
    visit(root, 0, 0);
    return result;
  }

  function treeCladeAssignments(root, depthFraction) {
    const depths = new Map();
    const tips = [];
    function measure(node, depth) {
      depths.set(node, depth);
      if (!node.children.length) tips.push(node);
      for (const child of node.children) measure(child, depth + branchLength(child));
    }
    measure(root, 0);
    const maxDepth = Math.max(...tips.map((tip) => depths.get(tip)), 0);
    const cutoff = maxDepth * clamp(depthFraction, 0, 1);
    const nodeByTip = new Map();
    function assign(node, cladeNode) {
      let selected = cladeNode;
      if (!selected && node !== root && depths.get(node) >= cutoff) selected = node;
      if (!node.children.length) {
        nodeByTip.set(node.name, selected || node);
        return;
      }
      for (const child of node.children) assign(child, selected);
    }
    assign(root, null);

    const cladeNodes = Array.from(new Set(nodeByTip.values())).map((node) => ({
      node,
      key: flattenTips(node).map((tip) => canonicalId(tip.name)).filter(Boolean).sort()[0] || ""
    })).sort((left, right) => left.key.localeCompare(right.key));
    const labelByNode = new Map(cladeNodes.map((entry, index) => [entry.node, `${TREE_CLADE_PREFIX}${index + 1}`]));
    return new Map(Array.from(nodeByTip, ([tipName, node]) => [tipName, labelByNode.get(node)]));
  }

  function midpointRootTree(root) {
    const graph = treeGraph(root);
    const leaves = Array.from(graph.keys()).filter((node) => !node.children.length);
    if (leaves.length < 2) return root;

    let best = { start: leaves[0], end: leaves[0], distance: -1, previous: new Map() };
    for (const leaf of leaves) {
      const search = graphDistances(graph, leaf);
      for (const other of leaves) {
        const distance = search.distances.get(other);
        if (other !== leaf && distance > best.distance) {
          best = { start: leaf, end: other, distance, previous: search.previous };
        }
      }
    }
    if (!(best.distance > 0)) return root;

    const path = pathBetween(best.start, best.end, best.previous);
    const midpoint = best.distance / 2;
    let walked = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      const a = path[index];
      const b = path[index + 1];
      const edge = edgeLength(graph, a, b);
      if (walked + edge >= midpoint) {
        const fromA = midpoint - walked;
        const fromB = edge - fromA;
        return buildRootedFromMidpoint(graph, a, b, fromA, fromB);
      }
      walked += edge;
    }
    return root;
  }

  function treeGraph(root) {
    const graph = new Map();
    for (const node of walkTree(root)) graph.set(node, []);
    for (const node of walkTree(root)) {
      for (const child of node.children) {
        const length = branchLength(child);
        graph.get(node).push({ node: child, length });
        graph.get(child).push({ node, length });
      }
    }
    return graph;
  }

  function graphDistances(graph, start) {
    const distances = new Map([[start, 0]]);
    const previous = new Map();
    const stack = [start];
    while (stack.length) {
      const node = stack.pop();
      for (const edge of graph.get(node) || []) {
        if (distances.has(edge.node)) continue;
        distances.set(edge.node, distances.get(node) + edge.length);
        previous.set(edge.node, node);
        stack.push(edge.node);
      }
    }
    return { distances, previous };
  }

  function pathBetween(start, end, previous) {
    const path = [end];
    let current = end;
    while (current !== start && previous.has(current)) {
      current = previous.get(current);
      path.push(current);
    }
    return path.reverse();
  }

  function buildRootedFromMidpoint(graph, a, b, fromA, fromB) {
    const root = { name: "midpoint_root", length: 0, children: [], parent: null, x: 0, y: 0 };
    const left = cloneDirectedTree(graph, a, b, Math.max(0, fromA), root);
    const right = cloneDirectedTree(graph, b, a, Math.max(0, fromB), root);
    root.children = [left, right].filter(Boolean);
    return root;
  }

  function cloneDirectedTree(graph, node, blocked, length, parent) {
    const clone = { name: node.name, length, children: [], parent, x: 0, y: 0 };
    for (const edge of graph.get(node) || []) {
      if (edge.node === blocked) continue;
      clone.children.push(cloneDirectedTree(graph, edge.node, node, edge.length, clone));
    }
    return clone;
  }

  function edgeLength(graph, a, b) {
    return (graph.get(a) || []).find((edge) => edge.node === b)?.length || 0;
  }

  function branchLength(node) {
    const length = Number(node.length);
    return Number.isFinite(length) && length > 0 ? length : 0.000001;
  }

  function extractGgrIds(bytes) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/[^\x20-\x7E]+/g, " ");
    const tokens = text.match(/[A-Za-z0-9_.|/:-]{4,}/g) || [];
    const ids = new Set();
    for (const token of tokens) {
      const cleaned = cleanLabel(token);
      if (looksLikeGenomeLabel(token, cleaned)) {
        for (const variant of idVariants(cleaned)) ids.add(variant);
      }
    }
    return ids;
  }

  function looksLikeGenomeLabel(raw, cleaned) {
    if (/GC[AF]_\d{6,}/i.test(raw)) return true;
    if (/\.(fna|fa|fasta|gbk|gbff)(\.gz)?$/i.test(raw)) return true;
    if (!/^[A-Za-z0-9_.-]+$/.test(cleaned)) return false;
    return /[._-]/.test(cleaned) && /\d/.test(cleaned) && cleaned.length <= 140;
  }

  function cleanLabel(value) {
    return cleanValue(value).replace(/^['"]|['"]$/g, "").split(/[\\/]/).pop().replace(/\.(fna|fa|fasta|gbk|gbff|gz)$/i, "");
  }

  function canonicalId(value) {
    const text = cleanLabel(value).toLowerCase();
    const accession = text.match(/(gc[af]_\d+(?:\.\d+)?)/i);
    return accession ? accession[1].toLowerCase() : text.replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function idVariants(value) {
    const base = canonicalId(value);
    const variants = new Set([base]);
    variants.add(base.replace(/\.\d+$/, ""));
    variants.add(base.replace(/_/g, "-"));
    variants.add(base.replace(/-/g, "_"));
    return Array.from(variants).filter(Boolean);
  }

  function idInSet(value, set) {
    if (!set.size) return false;
    return idVariants(value).some((variant) => set.has(variant));
  }

  function bestColumn(headers, candidates) {
    const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
    for (const candidate of candidates) {
      if (normalized.has(normalizeHeader(candidate))) return normalized.get(normalizeHeader(candidate));
    }
    for (const header of headers) {
      const norm = normalizeHeader(header);
      if (candidates.some((candidate) => norm.includes(normalizeHeader(candidate)))) return header;
    }
    return "";
  }

  function normalizeHeader(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function parseNumber(value) {
    const text = cleanValue(value);
    if (!text) return null;
    const number = Number.parseFloat(text);
    return Number.isFinite(number) ? number : null;
  }

  function parseLatLon(value) {
    const text = cleanValue(value).replace("°", " ");
    if (!text) return null;
    let match = text.match(/(-?\d+(?:\.\d+)?)\s*([NS])[,;\s]+(-?\d+(?:\.\d+)?)\s*([EW])/i);
    if (match) {
      let latitude = Math.abs(Number.parseFloat(match[1])) * (match[2].toUpperCase() === "S" ? -1 : 1);
      let longitude = Math.abs(Number.parseFloat(match[3])) * (match[4].toUpperCase() === "W" ? -1 : 1);
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
    }
    match = text.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      const latitude = Number.parseFloat(match[1]);
      const longitude = Number.parseFloat(match[2]);
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
    }
    return null;
  }

  function countryCentroid(value) {
    if (!value) return null;
    const first = value.split(":")[0].trim();
    const country = aliasCountry(first) || first;
    if (COUNTRY_CENTROIDS[country]) return COUNTRY_CENTROIDS[country];
    const lower = value.toLowerCase();
    for (const [alias, name] of Object.entries(COUNTRY_ALIASES)) {
      if (lower.includes(alias.toLowerCase())) return COUNTRY_CENTROIDS[name] || null;
    }
    for (const [name, coords] of Object.entries(COUNTRY_CENTROIDS)) {
      if (lower.includes(name.toLowerCase())) return coords;
    }
    return null;
  }

  function aliasCountry(value) {
    const lower = value.toLowerCase();
    for (const [alias, name] of Object.entries(COUNTRY_ALIASES)) {
      if (alias.toLowerCase() === lower) return name;
    }
    return "";
  }

  function project(longitude, latitude) {
    if (state.mapMode === "globe") return projectGlobe(longitude, latitude);
    const fit = flatFit();
    const baseX = fit.offsetX + (longitude - fit.bounds.minLon) * fit.scale;
    const baseY = fit.offsetY + (fit.bounds.maxLat - latitude) * fit.scale;
    return {
      x: W / 2 + (baseX - W / 2) * state.mapZoom + state.flatPanX,
      y: H / 2 + (baseY - H / 2) * state.mapZoom + state.flatPanY,
      visible: true,
      scale: clamp(0.92 + Math.log2(state.mapZoom + 0.15) * 0.08, 0.78, 1.25)
    };
  }

  function projectGlobe(longitude, latitude) {
    const view = globeView();
    const lambda = radians(longitude - state.rotationLon);
    const phi = radians(latitude);
    const phi0 = radians(state.rotationLat);
    const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
    const x = view.cx + view.radius * Math.cos(phi) * Math.sin(lambda);
    const y = view.cy - view.radius * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda));
    return {
      x,
      y,
      visible: cosc >= -0.015,
      scale: clamp(0.82 + Math.max(0, cosc) * 0.28, 0.82, 1.1)
    };
  }

  function globeView() {
    return {
      cx: W / 2,
      cy: H / 2,
      radius: Math.min(W, H) * 0.41 * state.mapZoom
    };
  }

  function densifyPolygon(polygon, step) {
    const result = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      result.push(start);
      const distance = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
      const pieces = Math.max(1, Math.ceil(distance / step));
      for (let piece = 1; piece < pieces; piece += 1) {
        const t = piece / pieces;
        result.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
      }
    }
    result.push(polygon[0]);
    return result;
  }

  function range(start, end, step) {
    const values = [];
    for (let value = start; value <= end; value += step) values.push(value);
    return values;
  }

  function radians(value) {
    return value * Math.PI / 180;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function wrapLongitude(value) {
    return ((((value + 180) % 360) + 360) % 360) - 180;
  }

  function jitterFor(id, count) {
    if (!count) return { x: 0, y: 0 };
    const angle = (hashCode(id) % 360) * Math.PI / 180;
    const radius = Math.min(13, 3 + count * 2);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  function colorFor(value) {
    if (value === TREE_CLADE_UNMATCHED) return "#93a29a";
    if (String(value).startsWith(TREE_CLADE_PREFIX)) {
      const index = Math.max(0, Number.parseInt(String(value).slice(TREE_CLADE_PREFIX.length), 10) - 1);
      const hue = Math.round((index * 137.508) % 360);
      return `hsl(${hue} 68% 62%)`;
    }
    return COLORS[Math.abs(hashCode(value || "missing")) % COLORS.length];
  }

  function hashCode(value) {
    let hash = 0;
    for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return hash;
  }

  function unique(values) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }

  function isMapped(genome) {
    return Number.isFinite(genome.latitude) && Number.isFinite(genome.longitude);
  }

  function cleanValue(value) {
    const text = value === null || value === undefined ? "" : String(value).trim();
    return MISSING.has(text.toLowerCase()) ? "" : text;
  }

  function setStatus(message) {
    el.statusText.textContent = message;
  }

  function svg(name, attrs, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function html(name, text, className) {
    const node = document.createElement(name);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }
})();
