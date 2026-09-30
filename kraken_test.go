package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKrakenStandardAndMinimizerReports(t *testing.T) {
	for _, name := range []string{"S01.kreport", "station_B_June.report.txt"} {
		b, err := os.ReadFile(filepath.Join("example/metagenomics/reports", name))
		if err != nil {
			t.Fatal(err)
		}
		p, err := parseKrakenReport(bytes.NewReader(b), "G")
		if err != nil {
			t.Fatal(err)
		}
		if p.Total != 1000 || p.Unclassified != 100 {
			t.Fatal("wrong denominator", p)
		}
		if name == "S01.kreport" {
			if len(p.Taxa) != 4 || p.Taxa[0].TaxID != "100001" || p.Taxa[0].Clade != 600 || p.Taxa[0].Direct != 50 || p.Taxa[0].Percent != 60 {
				t.Fatal("must use clade counts, not direct counts", p)
			}
			if p.Taxa[2].Percent != .1 || p.Taxa[3].Percent != 0 {
				t.Fatal("below-threshold and zero counts must be retained", p)
			}
		}
		p, err = parseKrakenReport(bytes.NewReader(b), "S")
		if err != nil || len(p.Taxa) != 2 {
			t.Fatal("exact rank selection", p, err)
		}
	}
	p, err := parseKrakenReport(strings.NewReader("100\t100\t100\tU\t0\tunclassified\n"), "G")
	if err != nil || len(p.Taxa) != 0 || p.Total != 100 {
		t.Fatal("all-unclassified reports are valid", p, err)
	}
	p, err = parseKrakenReport(strings.NewReader("100\t100\t0\tR\t1\troot\n100\t100\t100\tG\t5\tGenus\n"), "G")
	if err != nil || p.Total != 100 || p.Taxa[0].Percent != 100 {
		t.Fatal("zero-unclassified row may be omitted", p, err)
	}
}

func TestKrakenRejectsMalformedReports(t *testing.T) {
	root := "90\t900\t0\tR\t1\troot\n10\t100\t100\tU\t0\tunclassified\n"
	for _, text := range []string{
		"", "C\tread1\t5\t100\t5:10\n", "name\ttaxonomy_id\ttaxonomy_lvl\tkraken_assigned_reads\tadded_reads\tnew_est_reads\tfraction_total_reads\n",
		"0\t0\t0\tR\t1\troot\n", "50\t50\t50\tG\t5\tmissing root\n",
		root + "NaN\t1\t1\tG\t5\tbad\n", root + "1\t1.5\t1\tG\t5\tbad\n", root + "1\t-1\t1\tG\t5\tbad\n",
		root + "1\t10\t11\tG\t5\tbad\n", root + "1\t10\t0\twrong\t5\tbad\n", root + "1\t10\t0\tG\tbad\tbad\n",
		root + "1\t10\t0\tG\t5\t\n", root + "1\t10\t0\tG\t5\tA\n1\t10\t0\tG\t5\tA\n",
		root + "95\t950\t0\tG\t5\ttoo many\n", root + "80\t800\t0\tG\t5\tA\n80\t800\t0\tG\t6\tB\n",
		root + "20\t100\t0\tG\t5\twrong percent\n", root + "0\t0\t0\tR\t9\twrong root\n",
		"100\t9007199254740992\t0\tR\t1\troot\n",
	} {
		if _, err := parseKrakenReport(strings.NewReader(text), "G"); err == nil {
			t.Errorf("accepted malformed report %q", text)
		}
	}
	p, err := parseKrakenReport(strings.NewReader(root+"1\t10\t10\tG1\t5\tunranked descendant\n"), "G")
	if err != nil || len(p.Taxa) != 0 {
		t.Fatal("G1 must not be mixed with genus", p, err)
	}
}

func communityFixture(t *testing.T) *spaceTimeData {
	t.Helper()
	d, err := loadSpaceTimeMetadata("example/metagenomics/metadata.tsv", spaceTimeColumns{})
	if err != nil {
		t.Fatal(err)
	}
	return d
}
func TestKrakenFolderMatching(t *testing.T) {
	d := communityFixture(t)
	if err := loadKrakenReports("example/metagenomics/reports", "genus", 1, d); err != nil {
		t.Fatal(err)
	}
	if len(d.Observations) != 5 || len(d.Community.Profiles) != 4 || d.Community.Rank != "G" {
		t.Fatal(d.Community)
	}
	if d.Community.Profiles[2].Sample != 2 || d.Community.Profiles[2].Report != "station_B_June.report.txt" {
		t.Fatal("explicit mapping failed")
	}
	if !strings.Contains(strings.Join(d.Warnings, "\n"), "S05") {
		t.Fatal("missing report not disclosed")
	}
	if !containsString(d.Headers, "kraken_taxon") {
		t.Fatal("missing community color field")
	}
	if _, err := krakenRank("G1"); err == nil {
		t.Fatal("accepted nonstandard rank")
	}
	for _, name := range []string{"sample.kreport", "sample.report.txt", "sample.kraken2.report.txt", "sample_kraken2_report.tsv"} {
		if krakenReportStem(name) != "sample" {
			t.Error("bad filename matching", name)
		}
	}
}

func TestKrakenAmbiguousReportsAndMappings(t *testing.T) {
	dir := t.TempDir()
	report, err := os.ReadFile("example/metagenomics/reports/S01.kreport")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"S01.kreport", "S01.report"} {
		if err := os.WriteFile(filepath.Join(dir, name), report, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := loadKrakenReports(dir, "G", 1, communityFixture(t)); err == nil {
		t.Fatal("ambiguous reports accepted")
	}
	d := communityFixture(t)
	d.Observations[0].Metadata["kraken_report"] = "S01.kreport"
	if err := loadKrakenReports(dir, "G", 1, d); err != nil || len(d.Community.Profiles) != 1 {
		t.Fatal("explicit selection should resolve duplicate files", err)
	}
	d = communityFixture(t)
	d.Observations[0].Metadata["kraken_report"] = "../S01.kreport"
	if err := loadKrakenReports(dir, "G", 1, d); err == nil {
		t.Fatal("accepted report path outside folder")
	}
	d = communityFixture(t)
	d.Observations[1].Metadata["kraken_report"] = "station_B_June.report.txt"
	if err := loadKrakenReports(dir, "G", 1, d); err == nil {
		t.Fatal("accepted duplicate mappings")
	}
	d = communityFixture(t)
	d.Headers = append(d.Headers, "kraken_taxon")
	if err := loadKrakenReports(dir, "G", 1, d); err == nil {
		t.Fatal("overwrote a reserved metadata column")
	}
	if err := loadKrakenReports(t.TempDir(), "G", 1, communityFixture(t)); err == nil {
		t.Fatal("accepted unmatched/empty folder")
	}
}

func TestKrakenReportSuffixDoesNotMatchAnUnrelatedAlias(t *testing.T) {
	dir := t.TempDir()
	report, err := os.ReadFile("example/metagenomics/reports/S01.kreport")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "S01.kreport"), report, 0600); err != nil {
		t.Fatal(err)
	}
	d := communityFixture(t)
	d.Observations = append(d.Observations, SpaceTimeObservation{ID: "other/S01.kreport.fna", Metadata: map[string]string{}})
	if err = loadKrakenReports(dir, "G", 1, d); err != nil {
		t.Fatal(err)
	}
	if d.Community.Profiles[0].Sample != 0 {
		t.Fatal("report suffix matched an unrelated sample alias")
	}
}

func TestKrakenCLI(t *testing.T) {
	output := filepath.Join(t.TempDir(), "community.html")
	var log bytes.Buffer
	args := []string{"--metadata", "example/metagenomics/metadata.tsv", "--kraken-reports", "example/metagenomics/reports", "--taxonomic-rank", "genus", "--abundance-threshold", "1", "--color-by", "kraken_taxon", "--output", output}
	if err := runSpaceTime(args, &log); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(log.String(), "Kraken reports: 4; rank: G; taxon observations at >= 1%: 6") {
		t.Fatal(log.String())
	}
	b, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	prefix := `<script type="application/json" id="space-data">`
	start := bytes.Index(b, []byte(prefix))
	if start < 0 {
		t.Fatal("no embedded data")
	}
	payload := b[start+len(prefix):]
	payload = payload[:bytes.Index(payload, []byte("</script>"))]
	var data spaceTimeData
	if err := json.Unmarshal(payload, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Observations) != 5 || len(data.Relationships) != 0 || data.Community.Profiles[0].Taxa[2].Percent != .1 {
		t.Fatal("export discarded below-threshold data or changed samples")
	}
	for _, tc := range []struct {
		extra      []string
		diagnostic string
	}{
		{[]string{"--distances", "unused.tsv"}, "cannot be combined"},
		{[]string{"--abundance-threshold", "NaN"}, "finite percentage"},
		{[]string{"--abundance-threshold", "101"}, "finite percentage"},
		{[]string{"--taxonomic-rank", "invalid"}, "taxonomic rank must"},
	} {
		if err := runSpaceTime(append(args, tc.extra...), io.Discard); err == nil || !strings.Contains(err.Error(), tc.diagnostic) {
			t.Fatal("wrong invalid-flag diagnostic", tc.extra, err)
		}
	}
}

func TestKrakenHTTPUpload(t *testing.T) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for _, input := range []struct{ field, name, path string }{{"metadata", "metadata.tsv", "example/metagenomics/metadata.tsv"}, {"kraken-reports", "S01.kreport", "example/metagenomics/reports/S01.kreport"}} {
		part, err := form.CreateFormFile(input.field, input.name)
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(input.path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	form.WriteField("taxonomic-rank", "G")
	form.WriteField("abundance-threshold", "10")
	form.Close()
	r := httptest.NewRequest("POST", "http://127.0.0.1/space-time/generate", &body)
	r.Header.Set("Origin", "http://127.0.0.1")
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	staticHandler().ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"community":{"rank":"G","threshold":10`) {
		t.Fatalf("upload failed: %d %s", w.Code, w.Body.String()[:min(300, w.Body.Len())])
	}
}
