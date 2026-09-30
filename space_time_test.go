package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testTable(t *testing.T, text string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "table.tsv")
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSpaceDatePrecision(t *testing.T) {
	for _, tc := range []struct{ raw, start, end, precision string }{
		{"2024-06-17", "2024-06-17", "2024-06-17", "day"},
		{"2024-02", "2024-02-01", "2024-02-29", "month"},
		{"1900-02", "1900-02-01", "1900-02-28", "month"},
		{"2024", "2024-01-01", "2024-12-31", "year"},
		{"2021-2023", "2021-01-01", "2023-12-31", "range"},
		{"2021-05/2023-06", "2021-05-01", "2023-06-30", "range"},
		{"1900..2026", "1900-01-01", "2026-12-31", "range"},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			a, b, p, err := spaceDateInterval(tc.raw)
			if err != nil || a.Format("2006-01-02") != tc.start || b.Format("2006-01-02") != tc.end || p != tc.precision {
				t.Fatalf("%s: %v %v %s %v", tc.raw, a, b, p, err)
			}
		})
	}
	for _, raw := range []string{"", "0000", "2023-02-29", "2024-13", "2024-01-00", "tomorrow", "2023-2021", "2024/", "2024-1-3", "2024/2025/2026"} {
		if _, _, _, err := spaceDateInterval(raw); err == nil {
			t.Errorf("accepted invalid date %q", raw)
		}
	}
}

func TestSpaceNormalizedDates(t *testing.T) {
	h := []string{"collection_date_raw", "collection_date_start", "collection_date_end", "collection_date_precision", "custom_date"}
	row := map[string]string{"collection_date_raw": "2024", "collection_date_start": "2024-01-01", "collection_date_end": "2024-01-01", "collection_date_precision": "year", "custom_date": "2022-03"}
	a, b, p, err := observationDates(row, h, "")
	if err != nil || a != "2024-01-01" || b != "2024-12-31" || p != "year" {
		t.Fatalf("false precision: %s %s %s %v", a, b, p, err)
	}
	a, b, p, err = observationDates(row, h, "custom_date")
	if err != nil || a != "2022-03-01" || b != "2022-03-31" || p != "month" {
		t.Fatalf("override: %s %s %s %v", a, b, p, err)
	}
	row["collection_date_end"] = "2024-12-31"
	row["collection_date_precision"] = "day"
	if _, _, _, err = observationDates(row, h, ""); err == nil {
		t.Fatal("accepted contradictory precision")
	}
	row["collection_date_start"] = ""
	if _, _, _, err = observationDates(row, h, ""); err == nil {
		t.Fatal("accepted incomplete bounds")
	}
	row = map[string]string{"collection_date_raw": "", "collection_year": "2024", "collection_date_precision": "year"}
	h = []string{"collection_date_raw", "collection_year", "collection_date_precision", "collection_date_valid"}
	a, b, p, err = observationDates(row, h, "")
	if err != nil || a != "2024-01-01" || b != "2024-12-31" || p != "year" {
		t.Fatal("missing raw should fall back to year", a, b, p, err)
	}
	row["collection_date_raw"] = "2024-06-17"
	a, b, p, err = observationDates(row, h, "")
	if err != nil || a != "2024-01-01" || b != "2024-12-31" || p != "year" {
		t.Fatal("raw exact date must respect coarse declared precision", a, b, p, err)
	}
	row["collection_date_valid"] = "False"
	if _, _, _, err = observationDates(row, h, ""); err == nil {
		t.Fatal("ignored invalid-date flag")
	}
}

func TestSpaceSymmetryAcrossBlocks(t *testing.T) {
	const n = 130
	file, err := os.CreateTemp(t.TempDir(), "matrix")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	values := make([]byte, n*n*8)
	ids := make([]string, n)
	for i := 0; i < n; i++ {
		ids[i] = fmt.Sprint(i)
		for j := 0; j < n; j++ {
			binary.LittleEndian.PutUint64(values[(i*n+j)*8:], math.Float64bits(math.Abs(float64(i-j))))
		}
	}
	if _, err = file.Write(values); err != nil {
		t.Fatal(err)
	}
	if err = validateSpaceSymmetry(file, n, ids); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]int{{3, 129}, {128, 129}} {
		position := (pair[0]*n + pair[1]) * 8
		changed := make([]byte, 8)
		binary.LittleEndian.PutUint64(changed, math.Float64bits(999))
		if _, err = file.WriteAt(changed, int64(position)); err != nil {
			t.Fatal(err)
		}
		if err = validateSpaceSymmetry(file, n, ids); err == nil {
			t.Fatal("missed asymmetric block", pair)
		}
		if _, err = file.WriteAt(values[position:position+8], int64(position)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSpaceMetadataValidation(t *testing.T) {
	path := testTable(t, "\ufeffsample_id\tlatitude\tlongitude\tcollection_date\tnotes\n"+
		"ok\t0\t0\t2024\t\"quoted\tfield\nsecond line\"\n"+
		"dup\t1\t2\t2024\tx\n"+"dup\t1\t2\t2023\tx\n"+
		"lat\t91\t2\t2024\tx\n"+"lon\t1\t181\t2024\tx\n"+
		"missing\t\t2\t2024\tx\n"+"nan\tNaN\t2\t2024\tx\n"+
		"bad-number\t10north\t2\t2024\tx\n"+"no-date\t1\t2\t\tx\n"+
		"bad-date\t1\t2\t2024-02-30\tx\n"+"\t1\t2\t2024\tx\n")
	d, err := loadSpaceTimeMetadata(path, spaceTimeColumns{})
	if err != nil {
		t.Fatal(err)
	}
	if d.Loaded != 11 || len(d.Observations) != 1 || len(d.Excluded) != 10 {
		t.Fatalf("wrong counts: %+v", d)
	}
	if d.Observations[0].Metadata["notes"] != "quoted\tfield\nsecond line" {
		t.Fatal("CSV quoting not preserved")
	}
	if d.Excluded[0].Reason != "duplicate sample ID (all occurrences excluded)" || d.Excluded[1].Reason != d.Excluded[0].Reason {
		t.Fatal("duplicates must all be excluded")
	}
	if _, err := loadSpaceTimeMetadata(path, spaceTimeColumns{ID: "absent"}); err == nil {
		t.Fatal("accepted missing override")
	}
	if _, err := loadSpaceTimeMetadata(testTable(t, "sample_id,latitude,longitude,collection_date\na,0,0,2024,extra\n"), spaceTimeColumns{}); err == nil {
		t.Fatal("accepted malformed table")
	}
}

func TestSpaceCombinedCoordinates(t *testing.T) {
	d, err := loadSpaceTimeMetadata(testTable(t, "genome_id,lat_lon,collection_date\na,10 N 20 W,2024\nb,\"-10,30\",2024\n"), spaceTimeColumns{})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Observations) != 2 || d.Observations[0].Longitude != -20 || d.Observations[1].Latitude != -10 {
		t.Fatal(d.Observations)
	}
}

func distanceFixture() *spaceTimeData {
	return &spaceTimeData{Observations: []SpaceTimeObservation{{ID: "folder/A.fna"}, {ID: "B"}, {ID: "C"}, {ID: "missing"}}, MaxPerSample: 2, MaxEdges: 20, Relationships: []GenomicRelationship{}}
}
func TestSpaceDistanceMatchingAndLimits(t *testing.T) {
	path := testTable(t, "id\tC\tA\tB\toutside\nB\t3\t1\t0\t4\nA\t2\t0\t1\t4\noutside\t4\t4\t4\t0\nC\t0\t2\t3\t4\n")
	d := distanceFixture()
	if err := loadSpaceTimeDistances(path, d); err != nil {
		t.Fatal(err)
	}
	if len(d.Relationships) != 3 || d.Relationships[0].Distance != 1 {
		t.Fatal(d.Relationships)
	}
	warnings := strings.Join(d.Warnings, "\n")
	if !strings.Contains(warnings, "outside") || !strings.Contains(warnings, "missing") {
		t.Fatal(warnings)
	}
	d = distanceFixture()
	d.MaxPerSample = 1
	if err := loadSpaceTimeDistances(path, d); err != nil {
		t.Fatal(err)
	}
	if len(d.Relationships) != 1 {
		t.Fatal("degree cap not respected", d.Relationships)
	}
	d = distanceFixture()
	d.MaxEdges = 1
	if err := loadSpaceTimeDistances(path, d); err != nil {
		t.Fatal(err)
	}
	if len(d.Relationships) != 1 {
		t.Fatal("total cap")
	}
	d2 := distanceFixture()
	d2.MaxEdges = 1
	if err := loadSpaceTimeDistances(path, d2); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(d.Relationships) != fmt.Sprint(d2.Relationships) {
		t.Fatal("nondeterministic edges")
	}
}
func TestSpaceMalformedMatrices(t *testing.T) {
	for _, text := range []string{
		"id\tA\tB\nA\t0\t1\nB\t2\t0\n", // asymmetric
		"id\tA\tB\nA\t1\t1\nB\t1\t0\n", // diagonal
		"id\tA\tB\nA\t0\t-1\nB\t-1\t0\n",
		"id\tA\tB\nA\t0\tNaN\nB\tNaN\t0\n",
		"id\tA\tB\nA\t0\tInf\nB\tInf\t0\n",
		"id\tA\tB\nA\t0\t1\n", // missing row
		"id\tA\tB\nA\t0\t1\nA\t0\t1\n",
		"id\tA\tA\nA\t0\t1\nA\t1\t0\n",
		"id\tA\tB\nA\t0\nB\t1\t0\n",
		"id\tA\tB\nA\t0\t1\nX\t1\t0\n",
	} {
		if err := loadSpaceTimeDistances(testTable(t, text), distanceFixture()); err == nil {
			t.Errorf("accepted malformed matrix: %q", text)
		}
	}
	d := distanceFixture()
	d.Observations = append(d.Observations, SpaceTimeObservation{ID: "other/A.fa"})
	if err := loadSpaceTimeDistances(testTable(t, "id\tA\nA\t0\n"), d); err == nil {
		t.Fatal("accepted ambiguous alias")
	}
}

func TestSpaceClusters(t *testing.T) {
	d, err := loadSpaceTimeMetadata("example/space-time/metadata.tsv", spaceTimeColumns{})
	if err != nil {
		t.Fatal(err)
	}
	if err := loadSpaceTimeClusters("example/space-time/clusters.tsv", d); err != nil {
		t.Fatal(err)
	}
	if err := loadSpaceTimeClusters(testTable(t, "sample_id,cluster\nSYN-001,conflict\n"), d); err == nil {
		t.Fatal("accepted conflicting cluster")
	}
}

func TestSpaceCLIAndStandaloneHTML(t *testing.T) {
	output := filepath.Join(t.TempDir(), "figure.html")
	var log bytes.Buffer
	args := []string{"--metadata", "example/space-time/metadata.tsv", "--distances", "example/space-time/distances.tsv", "--clusters", "example/space-time/clusters.tsv", "--color-by", "lineage", "--output", output}
	if err := runSpaceTime(args, &log); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(log.String(), "Loaded: 72; mapped in space-time: 72; excluded: 0") {
		t.Fatal(log.String())
	}
	b, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	html := string(b)
	for _, want := range []string{"plotly.js (gl3d - minified)", `id="space-data"`, "SYN-072", "Collection time", "Genomic-neighbor connections", "Content-Security-Policy"} {
		if !strings.Contains(html, want) {
			t.Errorf("HTML missing %q", want)
		}
	}
	for _, unwanted := range []string{"<!--PLOTLY-->", "<!--DATA-->", "<!--APP-->", "<!--GEOGRAPHY-->", `<script src=`} {
		if strings.Contains(html, unwanted) {
			t.Errorf("HTML contains %q", unwanted)
		}
	}
	if err := runSpaceTime(args, io.Discard); err == nil {
		t.Fatal("overwrote an existing figure")
	}
	if err := runSpaceTime([]string{"--metadata", "example/space-time/metadata.tsv", "--tree", "x.tree"}, io.Discard); err == nil {
		t.Fatal("silently accepted deferred tree geometry")
	}
	if err := runSpaceTime(nil, io.Discard); err == nil {
		t.Fatal("missing metadata accepted")
	}
	d, err := loadSpaceTimeMetadata(testTable(t, "sample_id,latitude,longitude,collection_date,notes\nsafe,1,2,2024,</script><script>alert(1)</script>\n"), spaceTimeColumns{})
	if err != nil {
		t.Fatal(err)
	}
	safe, err := spaceTimeHTML(d)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(safe, []byte("</script><script>alert(1)")) {
		t.Fatal("user data escaped script context")
	}
}

func TestSpaceHTTP(t *testing.T) {
	handler := staticHandler()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/space-time", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Generate portable HTML") {
		t.Fatal(w.Code)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("metadata", "samples.tsv")
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprint(part, "sample_id,latitude,longitude,collection_date\nx,1,2,2024\n")
	form.Close()
	r := httptest.NewRequest("POST", "http://127.0.0.1/space-time/generate", bytes.NewReader(body.Bytes()))
	r.Header.Set("Content-Type", form.FormDataContentType())
	r.Header.Set("Origin", "http://127.0.0.1")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	r = httptest.NewRequest("POST", "http://127.0.0.1/space-time/generate", bytes.NewReader(body.Bytes()))
	r.Header.Set("Origin", "https://other.example")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("accepted cross-origin upload")
	}
}

func BenchmarkSpaceMetadata(b *testing.B) {
	for _, n := range []int{1000, 10000} {
		b.Run(fmt.Sprint(n), func(b *testing.B) {
			path := filepath.Join(b.TempDir(), "metadata.tsv")
			var text strings.Builder
			text.WriteString("sample_id\tlatitude\tlongitude\tcollection_date\tcluster\n")
			for i := 0; i < n; i++ {
				fmt.Fprintf(&text, "S%d\t%.6f\t%.6f\t%d\tC%d\n", i, 40+float64(i%100)/100, -75+float64(i%113)/100, 2019+i%7, i%12)
			}
			if err := os.WriteFile(path, []byte(text.String()), 0600); err != nil {
				b.Fatal(err)
			}
			b.ResetTimer()
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if _, err := loadSpaceTimeMetadata(path, spaceTimeColumns{}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkSpaceDistances(b *testing.B) {
	const n = 1000
	path := filepath.Join(b.TempDir(), "distances.tsv")
	f, err := os.Create(path)
	if err != nil {
		b.Fatal(err)
	}
	fmt.Fprint(f, "id")
	for i := 0; i < n; i++ {
		fmt.Fprintf(f, "\tS%d", i)
	}
	fmt.Fprintln(f)
	for i := 0; i < n; i++ {
		fmt.Fprintf(f, "S%d", i)
		for j := 0; j < n; j++ {
			distance := i - j
			if distance < 0 {
				distance = -distance
			}
			fmt.Fprintf(f, "\t%d", distance)
		}
		fmt.Fprintln(f)
	}
	f.Close()
	obs := make([]SpaceTimeObservation, n)
	for i := range obs {
		obs[i].ID = fmt.Sprintf("S%d", i)
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		d := &spaceTimeData{Observations: obs, MaxPerSample: 8, MaxEdges: 20000}
		if err := loadSpaceTimeDistances(path, d); err != nil {
			b.Fatal(err)
		}
	}
}
