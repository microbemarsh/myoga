# myoga

Local, browser-only visualization of Parsnp/Gingr outbreak datasets.

`myoga` loads three local files:

- `parsnp.ggr`
- `parsnp.tree`
- a metadata table for the genomes in the Parsnp run

The app keeps those files in your browser memory and does not upload genomic or
metadata content anywhere. It is intended for case-by-case confidential outbreak
review where a Microreact-like geographic/tree/metadata view is useful, but data
should remain on the local machine.

## Use A Release Executable

For non-technical users, use a packaged `myoga` executable for their operating
system:

- Windows: double-click `myoga.exe`
- macOS/Linux: double-click or open `myoga`

The executable starts a local-only server on `127.0.0.1`, opens the default
browser, and serves the bundled app, maps, and example files from inside the
binary. Genomic files and metadata selected in the browser stay on the local
machine. Close the launcher window to stop myoga.

## Use From Source

Open [index.html](./index.html) in a browser, or serve the directory locally:

```bash
python3 -m http.server 4173
```

Then visit <http://localhost:4173>.

Load the three files from the toolbar. Once metadata is detected, choose or
adjust the ID, latitude, longitude, location, and color columns in the left
panel if the automatic guesses are not right for your table.

The `Example` button loads the bundled example Parsnp files and dummy metadata
when the app is served locally. The map opens in an offline globe view. Drag the
globe to rotate it, scroll or use the `+`/`-` buttons to zoom, use `Reset` to
return to the default view, and switch to `Flat` when a panning equirectangular
overview is easier. Use the small edge controls on the left panel, right
metadata panel, and tree panel to collapse them when you want more map space.
Large phylogenomic trees can be scrolled with the trackpad/mouse wheel or
dragged inside the tree panel to pan across long labels and many tips.
Use `Midpoint root` to redraw the tree around its longest leaf-to-leaf midpoint,
or `Original root` to return to the input Newick rooting.

Use the `GeoJSON` file input to load a custom local outbreak geography layer.
Custom GeoJSON is rendered only in `Flat` mode, automatically switches the map
to flat view, and fits the map to the uploaded layer bounds. For genome points
to align, custom coordinates should be longitude/latitude in WGS84/EPSG:4326.
The `US Counties` map button loads a bundled county-level United States GeoJSON
for finer local outbreak views without selecting a file. It opens fitted to the
continental United States for a useful working zoom; pan or zoom out to inspect
Alaska, Hawaii, or Puerto Rico.

## Build Release Executables

Release binaries are built with Go and embed the static app assets:

```bash
scripts/build-release.sh v0.1.0
```

The script writes ignored release folders under `dist/`:

- `myoga-v0.1.0-windows-amd64/myoga.exe`
- `myoga-v0.1.0-windows-arm64/myoga.exe`
- `myoga-v0.1.0-linux-amd64/myoga`
- `myoga-v0.1.0-linux-arm64/myoga`
- `myoga-v0.1.0-darwin-amd64/myoga`
- `myoga-v0.1.0-darwin-arm64/myoga`

The binaries are self-contained. They do not require Python, Node, or command
line use by the end user.

## Metadata

CSV, TSV, and semicolon-delimited text are supported. The app tries to infer
common column names:

- Genome/sample ID: `genome`, `genome_id`, `sample_id`, `isolate`, `strain`,
  `accession`, `name`, `id`
- Latitude: `latitude`, `lat`, `decimal_latitude`
- Longitude: `longitude`, `lon`, `lng`, `decimal_longitude`
- Combined coordinates: `lat_lon`, `latitude_longitude`, `coordinates`
- Location/country: `location`, `geo_loc_name`, `country`,
  `geographic_location`
- Date: `collection_date`, `date`, `sample_date`

Rows with exact latitude/longitude are mapped directly. Rows without coordinates
can still be placed at a country centroid when a recognizable country appears in
the location/country column.

## Notes

- `parsnp.tree` is the authoritative source for phylogenetic labels.
- `parsnp.ggr` is read locally and used to cross-check genome names that can be
  extracted from the Gingr project file.
- The detailed world map/globe uses the bundled Natural Earth 50m countries
  GeoJSON under `assets/`, so no map tiles or metadata are requested from remote
  servers during use. If the HTML is opened directly from disk and the browser
  blocks local asset loading, myoga falls back to a simpler built-in basemap.
  Natural Earth vector data is public domain.
- `assets/us_counties_fips.geojson` is a bundled county-level United States
  GeoJSON from the Plotly datasets repository, commonly used for FIPS-keyed
  county maps.
