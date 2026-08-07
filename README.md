# myoga

**Map Your Own Genomics Atlas**

**myoga** is a local-first tool for geographically visualizing relatedness
trees from [mlvamaps](https://github.com/microbemarsh/mlvamaps) or
[Parsnp](https://github.com/marbl/parsnp) outbreak datasets.

It lets users explore phylogenomic trees, sample metadata, and geographic locations in a Microreact-like interface while keeping genomic and metadata files on their own machine.

---
<img width="1900" height="942" alt="image" src="https://github.com/user-attachments/assets/3fbc8e82-ee16-4ccc-aea7-f0081b997537" />

---

## Why build myoga?

myoga is designed for local review of sensitive outbreak datasets.

During normal use:

- users select files from their own machine
- files are kept in local browser memory
- the app is served from `127.0.0.1`
- no myoga server receives genomic files or metadata
- release builds work without external setup

---

## Quick Start

The easiest way to use myoga is to download a release.

1. Go to the **Releases** page.
2. Download the ZIP file for your operating system.
3. Unzip it.
4. Run the myoga executable.

Platform examples:

- **Windows:** double-click `myoga.exe`
- **macOS/Linux:** double-click or run `./myoga`

myoga starts a local server on:

```text
127.0.0.1
```

Then it opens the app in your default browser.

No Python, Node.js, or command-line setup is required for release builds.

---

## Load an MLVAmaps export

Run `mlvamaps export-myoga`, then use the **mlvamaps export** picker in myoga
to select its output directory. No `.ggr` file is needed. myoga recognizes:

- `mlva_nj.tree` with `myoga_metadata.tsv`
- `combined_marker_nj.tree` with `combined_marker_metadata.tsv`

When both pairs are present, myoga loads the tree containing the most samples;
ties prefer the combined-marker tree. The status panel reports which pair was
selected. You can still use the individual **Tree** and **Metadata** pickers to
choose a different pair.

For example:

```bash
mlvamaps export-myoga \
  --results mlvamaps_output/ \
  --metadata metadata.tsv \
  --combined-markers \
  --loci loci.csv \
  -o myoga_export/
```

Then select `myoga_export/` in myoga.

## Load a Parsnp dataset

The existing Parsnp workflow remains supported. Load `parsnp.tree`, its
metadata table, and optionally `parsnp.ggr`. GGR is used only to cross-check
genome identifiers; it is not required to draw the tree or map.

The app keeps all selected files in browser memory and does **not** upload
genomic data, metadata, coordinates, or outbreak files anywhere.

---

## What myoga Shows

myoga provides an interactive local view of:

- genome/sample locations on a map
- an mlvamaps relatedness tree or Parsnp phylogenomic tree
- linked sample metadata
- optional local GeoJSON geography layers
- bundled offline map data

It is intended for confidential, case-by-case outbreak review where data should remain local.

---

## Example Data

To get a better look at what myoga can do use the example data in the `assets/mers49` folder.

The example opens in an offline globe view. Users can switch between globe and flat map modes, inspect tree structure, view metadata, and test the interface without providing their own files.

---

## Documentation

Longer documentation is available in the project wiki.

- Metadata file creation
- Supported metadata columns
- Custom GeoJSON layers
- Troubleshooting

---

## Notes

- The selected Newick tree is the authoritative source for sample labels.
- mlvamaps exports do not require a `.ggr` file.
- For Parsnp data, `parsnp.ggr` is optional and is used only to cross-check
  genome names from the Parsnp/Gingr project file.
- myoga includes bundled map assets for offline-friendly use.
- Custom local GeoJSON layers can be loaded for outbreak-specific geography.

---

## Author

Austin G. Marshall
