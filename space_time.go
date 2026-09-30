package main

import (
	"bufio"
	"container/heap"
	"crypto/sha256"
	"encoding/binary"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Observations, relationships and browser settings are deliberately separate.
type SpaceTimeObservation struct {
	ID        string            `json:"id"`
	Latitude  float64           `json:"latitude"`
	Longitude float64           `json:"longitude"`
	Start     string            `json:"start"`
	End       string            `json:"end"`
	Precision string            `json:"precision"`
	Metadata  map[string]string `json:"metadata"`
}
type GenomicRelationship struct {
	A        int     `json:"a"`
	B        int     `json:"b"`
	Distance float64 `json:"distance"`
}
type exclusion struct {
	Row    int    `json:"row"`
	ID     string `json:"id"`
	Reason string `json:"reason"`
}
type spaceTimeData struct {
	Version       int                    `json:"version"`
	Fingerprint   string                 `json:"fingerprint"`
	Observations  []SpaceTimeObservation `json:"observations"`
	Relationships []GenomicRelationship  `json:"relationships"`
	Headers       []string               `json:"headers"`
	Excluded      []exclusion            `json:"excluded"`
	Warnings      []string               `json:"warnings"`
	Loaded        int                    `json:"loaded"`
	ColorBy       string                 `json:"colorBy"`
	MaxEdges      int                    `json:"maxEdges"`
	MaxPerSample  int                    `json:"maxPerSample"`
	DistanceLabel string                 `json:"distanceLabel"`
	DistanceMax   float64                `json:"distanceMax"`
	Community     *KrakenCommunity       `json:"community,omitempty"`
}
type spaceTimeColumns struct{ ID, Lat, Lon, Time string }

func runSpaceTime(args []string, out io.Writer) error {
	f := flag.NewFlagSet("myoga space-time", flag.ContinueOnError)
	f.SetOutput(out)
	metadata := f.String("metadata", "", "required CSV/TSV metadata")
	distances := f.String("distances", "", "optional labeled symmetric distance matrix (CSV/TSV)")
	clusters := f.String("clusters", "", "optional CSV/TSV with sample_id and cluster columns")
	tree := f.String("tree", "", "phylogenetic geometry is deferred; use the existing tree viewer")
	output := f.String("output", "surveillance_4d.html", "standalone offline HTML output")
	color := f.String("color-by", "", "initial metadata color column")
	id := f.String("id-column", "", "override sample ID column")
	lat := f.String("lat-column", "", "override latitude column")
	lon := f.String("lon-column", "", "override longitude column")
	date := f.String("time-column", "", "override date column (ignores standardized date bounds)")
	k := f.Int("max-edges-per-sample", 8, "maximum degree in the sparse genomic-neighbor graph (1–100)")
	limit := f.Int("max-edges", 20000, "maximum retained genomic-neighbor edges (1–200000)")
	label := f.String("distance-label", "genomic distance (input units)", "distance units/metric label; values are never rescaled")
	kraken := f.String("kraken-reports", "", "folder of Kraken2 per-sample summary reports (not per-read output)")
	rank := f.String("taxonomic-rank", "G", "Kraken taxonomic rank: D, K, P, C, O, F, G or S")
	abundance := f.Float64("abundance-threshold", 1, "initial Kraken clade percentage threshold (0–100; adjustable in the viewer)")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %s", strings.Join(f.Args(), " "))
	}
	if *tree != "" {
		return errors.New("phylogenetic space-time edges are deferred: internal nodes have no observed geographic coordinates; omit --tree and inspect it in the existing myoga tree viewer")
	}
	if *metadata == "" {
		return errors.New("--metadata is required; use myoga space-time --help")
	}
	if math.IsNaN(*abundance) || math.IsInf(*abundance, 0) || *abundance < 0 || *abundance > 100 {
		return errors.New("--abundance-threshold must be a finite percentage from 0 to 100")
	}
	if *kraken != "" && *distances != "" {
		return errors.New("--kraken-reports cannot be combined with --distances: taxon proportions do not establish genomic relationships")
	}
	if *kraken == "" && (*rank != "G" || *abundance != 1) {
		return errors.New("--taxonomic-rank and --abundance-threshold require --kraken-reports")
	}
	if *k < 1 || *k > 100 || *limit < 1 || *limit > 200000 {
		return errors.New("edge limits must be 1–100 per sample and 1–200000 total")
	}
	d, err := loadSpaceTimeMetadata(*metadata, spaceTimeColumns{*id, *lat, *lon, *date})
	if err != nil {
		return err
	}
	d.MaxEdges, d.MaxPerSample, d.DistanceLabel = *limit, *k, *label
	if *clusters != "" {
		if err := loadSpaceTimeClusters(*clusters, d); err != nil {
			return err
		}
	}
	if *kraken != "" {
		if err := loadKrakenReports(*kraken, *rank, *abundance, d); err != nil {
			return err
		}
	}
	if *color != "" && !containsString(d.Headers, *color) {
		return fmt.Errorf("color column %q not found", *color)
	}
	d.ColorBy = *color
	if *distances != "" {
		if err := loadSpaceTimeDistances(*distances, d); err != nil {
			return err
		}
	}
	// Bind saved settings to observations AND the retained graph.
	payload, err := json.Marshal(d)
	if err != nil {
		return err
	}
	d.Fingerprint = fmt.Sprintf("%x", sha256.Sum256(payload))
	html, err := spaceTimeHTML(d)
	if err != nil {
		return err
	}
	// Never overwrite an input or an existing figure inadvertently.
	file, err := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create output: %w (choose an unused --output path)", err)
	}
	_, writeErr := file.Write(html)
	closeErr := file.Close()
	if writeErr != nil {
		_ = os.Remove(*output)
		return writeErr
	}
	if closeErr != nil {
		_ = os.Remove(*output)
		return closeErr
	}
	fmt.Fprintf(out, "Loaded: %d; mapped in space-time: %d; excluded: %d\n", d.Loaded, len(d.Observations), len(d.Excluded))
	counts := map[string]int{}
	for _, e := range d.Excluded {
		counts[e.Reason]++
	}
	reasons := make([]string, 0, len(counts))
	for reason := range counts {
		reasons = append(reasons, reason)
	}
	sort.Strings(reasons)
	for _, reason := range reasons {
		fmt.Fprintf(out, "  %d %s\n", counts[reason], reason)
	}
	for _, warning := range d.Warnings {
		fmt.Fprintln(out, warning)
	}
	if d.Community != nil {
		points := 0
		for _, profile := range d.Community.Profiles {
			for _, taxon := range profile.Taxa {
				if taxon.Percent > 0 && taxon.Percent >= d.Community.Threshold {
					points++
				}
			}
		}
		fmt.Fprintf(out, "Kraken reports: %d; rank: %s; taxon observations at >= %g%%: %d\n", len(d.Community.Profiles), d.Community.Rank, d.Community.Threshold, points)
	}
	fmt.Fprintf(out, "Genomic-neighbor edges: %d. Wrote %s\n", len(d.Relationships), *output)
	return nil
}

var headerPunctuation = regexp.MustCompile(`[^a-z0-9]+`)

func normalizeSpaceHeader(s string) string {
	return strings.Trim(headerPunctuation.ReplaceAllString(strings.ToLower(s), "_"), "_")
}
func spaceMissing(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "na", "n/a", "none", "null", "missing", "unknown", "not provided", "not collected", "not determined", "not available":
		return true
	}
	return false
}
func containsString(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}
func spaceColumn(headers []string, override string, aliases ...string) (string, error) {
	if override != "" {
		if containsString(headers, override) {
			return override, nil
		}
		return "", fmt.Errorf("column %q not found", override)
	}
	for _, alias := range aliases {
		for _, h := range headers {
			if normalizeSpaceHeader(h) == alias {
				return h, nil
			}
		}
	}
	return "", nil
}

// encoding/csv also handles quoted tabs, embedded newlines and BOM-prefixed exports.
func openSpaceTable(path string) (*os.File, *csv.Reader, []string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, nil, err
	}
	b := bufio.NewReader(f)
	prefix, _ := b.Peek(3)
	if string(prefix) == "\xef\xbb\xbf" {
		_, _ = b.Discard(3)
	}
	line, err := b.ReadString('\n')
	if err != nil && err != io.EOF {
		f.Close()
		return nil, nil, nil, err
	}
	delimiter, best := '\t', 0
	for _, sep := range []rune{'\t', ',', ';'} {
		r := csv.NewReader(strings.NewReader(line))
		r.Comma = sep
		h, e := r.Read()
		if e == nil && len(h) > best {
			delimiter, best = sep, len(h)
		}
	}
	r := csv.NewReader(io.MultiReader(strings.NewReader(line), b))
	r.Comma = delimiter
	h, err := r.Read()
	if err != nil {
		f.Close()
		return nil, nil, nil, fmt.Errorf("read header: %w", err)
	}
	for i := range h {
		h[i] = strings.TrimSpace(h[i])
	}
	return f, r, h, nil
}

var spaceDatePattern = regexp.MustCompile(`^\d{4}(-\d{2}(-\d{2})?)?$`)
var spaceYearRange = regexp.MustCompile(`^(\d{4})-(\d{4})$`)

func spaceDateInterval(raw string) (time.Time, time.Time, string, error) {
	raw = strings.TrimSpace(raw)
	parts := spaceYearRange.FindStringSubmatch(raw)
	var left, right string
	if parts != nil {
		left, right = parts[1], parts[2]
	} else {
		for _, sep := range []string{"/", ".."} {
			if strings.Contains(raw, sep) {
				pair := strings.Split(raw, sep)
				if len(pair) == 2 {
					left, right = pair[0], pair[1]
				}
				break
			}
		}
	}
	if left != "" && right != "" {
		a, _, _, ea := spaceDateInterval(left)
		_, b, _, eb := spaceDateInterval(right)
		if ea != nil || eb != nil || b.Before(a) {
			return time.Time{}, time.Time{}, "", errors.New("invalid date range")
		}
		return a, b, "range", nil
	}
	if !spaceDatePattern.MatchString(raw) || strings.HasPrefix(raw, "0000") {
		return time.Time{}, time.Time{}, "", fmt.Errorf("invalid date %q", raw)
	}
	layout, precision := "2006", "year"
	if len(raw) == 7 {
		layout, precision = "2006-01", "month"
	}
	if len(raw) == 10 {
		layout, precision = "2006-01-02", "day"
	}
	a, err := time.Parse(layout, raw)
	if err != nil {
		return a, a, "", err
	}
	b := a
	if precision == "year" {
		b = a.AddDate(1, 0, -1)
	}
	if precision == "month" {
		b = a.AddDate(0, 1, -1)
	}
	return a, b, precision, nil
}
func observationDates(row map[string]string, headers []string, override string) (string, string, string, error) {
	get := func(aliases ...string) string {
		c, _ := spaceColumn(headers, "", aliases...)
		return strings.TrimSpace(row[c])
	}
	raw := ""
	for _, alias := range []string{"collection_date_raw", "collection_date", "date", "sample_date", "isolation_date", "collection", "collection_year"} {
		if value := get(alias); !spaceMissing(value) {
			raw = value
			break
		}
	}
	start, end, precision := get("collection_date_start"), get("collection_date_end"), strings.ToLower(get("collection_date_precision"))
	if override != "" {
		raw = row[override]
		start, end, precision = "", "", ""
	} else if strings.EqualFold(get("collection_date_valid"), "false") {
		return "", "", "", errors.New("collection date marked invalid in metadata")
	}
	var a, b time.Time
	var p string
	var err error
	if !spaceMissing(start) || !spaceMissing(end) {
		if spaceMissing(start) || spaceMissing(end) {
			return "", "", "", errors.New("incomplete date bounds")
		}
		a, _, _, err = spaceDateInterval(start)
		if err != nil {
			return "", "", "", err
		}
		_, b, _, err = spaceDateInterval(end)
		if err != nil || b.Before(a) {
			return "", "", "", errors.New("invalid date bounds")
		}
		p = "range"
		if a.Equal(b) {
			p = "day"
		}
	} else {
		if spaceMissing(raw) {
			return "", "", "", errors.New("missing collection date")
		}
		a, b, p, err = spaceDateInterval(raw)
		if err != nil {
			return "", "", "", err
		}
	}
	// Coarse precision must never become a single precise date, even in legacy exports.
	if precision == "year" || precision == "month" {
		format := "2006"
		if precision == "month" {
			format = "2006-01"
		}
		a, _, _, _ = spaceDateInterval(a.Format(format))
		_, b, _, _ = spaceDateInterval(b.Format(format))
		p = precision
	} else if !spaceMissing(precision) {
		if (precision == "day" || precision == "exact") && !a.Equal(b) {
			return "", "", "", errors.New("day precision conflicts with interval")
		}
		p = precision
	}
	return a.Format("2006-01-02"), b.Format("2006-01-02"), p, nil
}

func loadSpaceTimeMetadata(path string, c spaceTimeColumns) (*spaceTimeData, error) {
	f, r, h, err := openSpaceTable(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	normalizedHeaders := map[string]bool{}
	for _, header := range h {
		if header == "" {
			return nil, errors.New("metadata headers cannot be empty")
		}
		normalized := normalizeSpaceHeader(header)
		if normalizedHeaders[normalized] {
			return nil, fmt.Errorf("ambiguous metadata header %q", header)
		}
		normalizedHeaders[normalized] = true
	}
	c.ID, err = spaceColumn(h, c.ID, "sample_id", "genome", "genome_id", "sample", "isolate", "isolate_id", "strain", "accession", "assembly_accession", "name", "id")
	if err != nil {
		return nil, err
	}
	c.Lat, err = spaceColumn(h, c.Lat, "latitude", "lat", "decimal_latitude", "decimal_lat", "metadata_latitude", "y")
	if err != nil {
		return nil, err
	}
	c.Lon, err = spaceColumn(h, c.Lon, "longitude", "lon", "lng", "long", "decimal_longitude", "decimal_lon", "decimal_lng", "metadata_longitude", "x")
	if err != nil {
		return nil, err
	}
	if c.Time != "" {
		if _, err = spaceColumn(h, c.Time); err != nil {
			return nil, err
		}
	}
	combined, _ := spaceColumn(h, "", "lat_lon", "latitude_longitude", "coordinates", "coord", "gps", "geographic_coordinates", "lat_lon_raw")
	if c.ID == "" || ((c.Lat == "" || c.Lon == "") && combined == "") {
		return nil, errors.New("metadata needs sample ID and latitude/longitude columns (or lat_lon); use column override flags")
	}
	d := &spaceTimeData{Version: 1, Headers: h, Observations: []SpaceTimeObservation{}, Relationships: []GenomicRelationship{}, Excluded: []exclusion{}, Warnings: []string{}}
	rows := []map[string]string{}
	ids := map[string]int{}
	for {
		values, e := r.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, fmt.Errorf("metadata row %d: %w", len(rows)+2, e)
		}
		row := map[string]string{}
		for i, v := range values {
			row[h[i]] = strings.TrimSpace(v)
		}
		rows = append(rows, row)
		ids[row[c.ID]]++
	}
	d.Loaded = len(rows)
	for i, row := range rows {
		id := row[c.ID]
		reason := ""
		if spaceMissing(id) {
			reason = "missing sample ID"
		} else if ids[id] > 1 {
			reason = "duplicate sample ID (all occurrences excluded)"
		}
		latitude, longitude := row[c.Lat], row[c.Lon]
		if spaceMissing(latitude) && spaceMissing(longitude) && combined != "" {
			pair := spaceLatLon(row[combined])
			if pair != nil {
				latitude, longitude = pair[0], pair[1]
			}
		}
		lat, ea := strconv.ParseFloat(latitude, 64)
		lon, eb := strconv.ParseFloat(longitude, 64)
		if reason == "" {
			if spaceMissing(latitude) || spaceMissing(longitude) {
				reason = "missing coordinates"
			} else if ea != nil || eb != nil || math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
				reason = "invalid coordinates"
			}
		}
		start, end, precision, ed := observationDates(row, h, c.Time)
		if reason == "" && ed != nil {
			reason = "invalid collection date"
			if ed.Error() == "missing collection date" {
				reason = ed.Error()
			}
		}
		if reason != "" {
			d.Excluded = append(d.Excluded, exclusion{i + 2, id, reason})
			continue
		}
		d.Observations = append(d.Observations, SpaceTimeObservation{id, lat, lon, start, end, precision, row})
	}
	if len(d.Observations) == 0 {
		return nil, fmt.Errorf("no valid space-time observations: %d rows excluded (check IDs, coordinates and dates)", len(d.Excluded))
	}
	return d, nil
}

var directionalCoordinates = regexp.MustCompile(`(?i)^\s*(-?\d+(?:\.\d+)?)\s*([NS])[,;\s]+(-?\d+(?:\.\d+)?)\s*([EW])\s*$`)

func spaceLatLon(s string) []string {
	s = strings.ReplaceAll(s, "°", " ")
	if m := directionalCoordinates.FindStringSubmatch(s); m != nil {
		a, _ := strconv.ParseFloat(m[1], 64)
		b, _ := strconv.ParseFloat(m[3], 64)
		a, b = math.Abs(a), math.Abs(b)
		if strings.EqualFold(m[2], "S") {
			a = -a
		}
		if strings.EqualFold(m[4], "W") {
			b = -b
		}
		return []string{strconv.FormatFloat(a, 'g', -1, 64), strconv.FormatFloat(b, 'g', -1, 64)}
	}
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ';' })
	if len(parts) == 2 {
		return []string{strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])}
	}
	return nil
}

// Exact IDs win. Fallbacks follow the existing browser's basename/FASTA suffix
// conventions, but ambiguous aliases are rejected rather than merged silently.
func spaceIDAlias(s string) string {
	s = filepath.Base(strings.ReplaceAll(strings.TrimSpace(s), "\\", "/"))
	for _, suffix := range []string{".gz", ".fasta", ".fna", ".fa", ".fas", ".gbk", ".gbff"} {
		if strings.HasSuffix(strings.ToLower(s), suffix) {
			s = s[:len(s)-len(suffix)]
		}
	}
	return s
}
func spaceIDMatcher(obs []SpaceTimeObservation) func(string) (int, error) {
	exact, aliases := map[string]int{}, map[string]int{}
	for i, o := range obs {
		exact[o.ID] = i
		a := spaceIDAlias(o.ID)
		if _, ok := aliases[a]; ok {
			aliases[a] = -1
		} else {
			aliases[a] = i
		}
	}
	return func(id string) (int, error) {
		if i, ok := exact[id]; ok {
			return i, nil
		}
		if i, ok := aliases[spaceIDAlias(id)]; ok {
			if i < 0 {
				return -1, fmt.Errorf("ambiguous sample alias %q; use exact sample IDs", id)
			}
			return i, nil
		}
		return -1, nil
	}
}
func loadSpaceTimeClusters(path string, d *spaceTimeData) error {
	f, r, h, err := openSpaceTable(path)
	if err != nil {
		return err
	}
	defer f.Close()
	uniqueHeaders := map[string]bool{}
	for _, header := range h {
		normalized := normalizeSpaceHeader(header)
		if normalized == "" || uniqueHeaders[normalized] {
			return fmt.Errorf("empty or duplicate cluster header %q", header)
		}
		uniqueHeaders[normalized] = true
	}
	id, _ := spaceColumn(h, "", "sample_id", "genome_id", "id")
	cluster, _ := spaceColumn(h, "", "cluster")
	if id == "" || cluster == "" {
		return errors.New("cluster table requires sample_id and cluster columns")
	}
	match := spaceIDMatcher(d.Observations)
	seen := map[string]bool{}
	assigned := map[int]bool{}
	unmatched := []string{}
	for {
		values, e := r.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return e
		}
		row := map[string]string{}
		for i, v := range values {
			row[h[i]] = strings.TrimSpace(v)
		}
		name := row[id]
		if spaceMissing(name) || seen[name] {
			return fmt.Errorf("missing or duplicate cluster sample ID %q", name)
		}
		seen[name] = true
		i, e := match(name)
		if e != nil {
			return e
		}
		if i < 0 {
			unmatched = append(unmatched, name)
			continue
		}
		if assigned[i] {
			return fmt.Errorf("multiple cluster IDs match %q", d.Observations[i].ID)
		}
		assigned[i] = true
		if old := d.Observations[i].Metadata["cluster"]; !spaceMissing(old) && old != row[cluster] {
			return fmt.Errorf("cluster assignment conflicts with metadata for %q", name)
		}
		d.Observations[i].Metadata["cluster"] = row[cluster]
	}
	if !containsString(d.Headers, "cluster") {
		d.Headers = append(d.Headers, "cluster")
	}
	if len(unmatched) > 0 {
		d.Warnings = append(d.Warnings, "Cluster IDs absent from mapped metadata: "+strings.Join(unmatched, ", "))
	}
	return nil
}

type neighborHeap []GenomicRelationship

func (h neighborHeap) Len() int { return len(h) }
func edgeLess(a, b GenomicRelationship) bool {
	if a.Distance != b.Distance {
		return a.Distance < b.Distance
	}
	if a.A != b.A {
		return a.A < b.A
	}
	return a.B < b.B
}
func (h neighborHeap) Less(i, j int) bool  { return edgeLess(h[j], h[i]) }
func (h neighborHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *neighborHeap) Push(x interface{}) { *h = append(*h, x.(GenomicRelationship)) }
func (h *neighborHeap) Pop() interface{} {
	old := *h
	v := old[len(old)-1]
	*h = old[:len(old)-1]
	return v
}

func loadSpaceTimeDistances(path string, d *spaceTimeData) error {
	f, r, h, err := openSpaceTable(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if len(h) < 2 {
		return errors.New("distance matrix requires header IDs and row labels")
	}
	ids := h[1:]
	n := len(ids)
	columns := map[string]int{}
	mapping := make([]int, n)
	matched := map[int]bool{}
	match := spaceIDMatcher(d.Observations)
	unmatched := []string{}
	for j, id := range ids {
		if spaceMissing(id) {
			return errors.New("missing distance matrix ID")
		}
		if _, exists := columns[id]; exists {
			return fmt.Errorf("duplicate matrix ID %q", id)
		}
		columns[id] = j
		i, e := match(id)
		if e != nil {
			return e
		}
		mapping[j] = i
		if i < 0 {
			unmatched = append(unmatched, id)
		} else {
			if matched[i] {
				return fmt.Errorf("multiple matrix IDs match %q", d.Observations[i].ID)
			}
			matched[i] = true
		}
	}
	// Spool numeric rows for exact symmetry validation without an N² RAM array.
	spool, err := os.CreateTemp("", "myoga-distances-*.bin")
	if err != nil {
		return err
	}
	defer os.Remove(spool.Name())
	defer spool.Close()
	seen := make([]bool, n)
	candidates := map[[2]int]GenomicRelationship{}
	bytes := make([]byte, n*8)
	for row := 0; ; row++ {
		values, e := r.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return fmt.Errorf("matrix row %d: %w", row+2, e)
		}
		name := strings.TrimSpace(values[0])
		i, ok := columns[name]
		if !ok || seen[i] {
			return fmt.Errorf("unknown or duplicate matrix row %q", name)
		}
		seen[i] = true
		neighbors := &neighborHeap{}
		for j, raw := range values[1:] {
			v, e := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if e != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
				return fmt.Errorf("invalid nonnegative distance at %q / %q", name, ids[j])
			}
			if i == j && v != 0 {
				return fmt.Errorf("matrix diagonal must be zero for %q", name)
			}
			binary.LittleEndian.PutUint64(bytes[j*8:], math.Float64bits(v))
			if i == j || mapping[i] < 0 || mapping[j] < 0 {
				continue
			}
			a, b := mapping[i], mapping[j]
			if a > b {
				a, b = b, a
			}
			edge := GenomicRelationship{a, b, v}
			if v > d.DistanceMax {
				d.DistanceMax = v
			}
			if neighbors.Len() < d.MaxPerSample {
				heap.Push(neighbors, edge)
			} else if edgeLess(edge, (*neighbors)[0]) {
				(*neighbors)[0] = edge
				heap.Fix(neighbors, 0)
			}
		}
		if _, e = spool.WriteAt(bytes, int64(i)*int64(n)*8); e != nil {
			return e
		}
		for _, edge := range *neighbors {
			candidates[[2]int{edge.A, edge.B}] = edge
		}
	}
	for i, yes := range seen {
		if !yes {
			return fmt.Errorf("missing matrix row %q", ids[i])
		}
	}
	if err := validateSpaceSymmetry(spool, n, ids); err != nil {
		return err
	}
	edges := make([]GenomicRelationship, 0, len(candidates))
	for _, e := range candidates {
		edges = append(edges, e)
	}
	sort.Slice(edges, func(i, j int) bool { return edgeLess(edges[i], edges[j]) })
	degree := make([]int, len(d.Observations))
	for _, e := range edges {
		if len(d.Relationships) >= d.MaxEdges {
			break
		}
		if degree[e.A] >= d.MaxPerSample || degree[e.B] >= d.MaxPerSample {
			continue
		}
		d.Relationships = append(d.Relationships, e)
		degree[e.A]++
		degree[e.B]++
	}
	if len(unmatched) > 0 {
		d.Warnings = append(d.Warnings, "Matrix IDs absent from mapped metadata: "+strings.Join(unmatched, ", "))
	}
	missing := []string{}
	for i, o := range d.Observations {
		if !matched[i] {
			missing = append(missing, o.ID)
		}
	}
	if len(missing) > 0 {
		d.Warnings = append(d.Warnings, "Mapped metadata IDs absent from matrix: "+strings.Join(missing, ", "))
	}
	d.Warnings = append(d.Warnings, fmt.Sprintf("Sparse genomic-neighbor graph: up to %d nearest candidates per sample, greedy degree cap %d, total cap %d; threshold applies only to retained edges.", d.MaxPerSample, d.MaxPerSample, d.MaxEdges))
	return nil
}
func validateSpaceSymmetry(f *os.File, n int, ids []string) error {
	// 128-row blocks keep symmetry checking at O(N²) I/O and O(128N) memory.
	const block = 128
	for start := 0; start < n; start += block {
		count := block
		if n-start < count {
			count = n - start
		}
		rows := make([]byte, count*n*8)
		mirror := make([]byte, count*8)
		if _, err := f.ReadAt(rows, int64(start)*int64(n)*8); err != nil {
			return err
		}
		for j := start; j < n; j++ {
			if _, err := f.ReadAt(mirror, (int64(j)*int64(n)+int64(start))*8); err != nil {
				return err
			}
			for k := 0; k < count && start+k < j; k++ {
				a := math.Float64frombits(binary.LittleEndian.Uint64(rows[(k*n+j)*8:]))
				b := math.Float64frombits(binary.LittleEndian.Uint64(mirror[k*8:]))
				if a != b {
					return fmt.Errorf("asymmetric distances at %q / %q", ids[start+k], ids[j])
				}
			}
		}
	}
	return nil
}

func spaceTimeHTML(d *spaceTimeData) ([]byte, error) {
	payload, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	paths := []string{"src/space-time.html", "assets/vendor/plotly-gl3d-2.35.2.min.js", "src/space-time.js", "assets/ne_50m_admin_0_countries.geojson"}
	parts := make([]string, len(paths))
	for i, p := range paths {
		b, e := appFiles.ReadFile(p)
		if e != nil {
			return nil, e
		}
		parts[i] = string(b)
	}
	// json.Marshal HTML-escapes user data; no untrusted bytes enter executable JS.
	geo := json.RawMessage(parts[3])
	safeGeo, err := json.Marshal(geo)
	if err != nil {
		return nil, err
	}
	license, err := appFiles.ReadFile("assets/vendor/plotly-LICENSE")
	if err != nil {
		return nil, err
	}
	notices, err := appFiles.ReadFile("assets/vendor/plotly-gl3d.min.js.LICENSE.txt")
	if err != nil {
		return nil, err
	}
	attribution := "<details><summary>Renderer licenses · Plotly.js 2.35.2</summary><pre>" + html.EscapeString(string(license)+"\n"+string(notices)) + "</pre></details>"
	replacer := strings.NewReplacer("<!--PLOTLY-->", "<script>"+parts[1]+"</script>", "<!--DATA-->", "<script type=\"application/json\" id=\"space-data\">"+string(payload)+"</script>", "<!--GEOGRAPHY-->", "<script type=\"application/json\" id=\"space-geography\">"+string(safeGeo)+"</script>", "<!--APP-->", "<script>"+parts[2]+"</script>", "<!--LICENSES-->", attribution)
	return []byte(replacer.Replace(parts[0])), nil
}
