package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Samples retain their original IDs and metadata. Community profiles are
// separate from observations and genomic relationships, including at zero reads.
type KrakenCommunity struct {
	Rank      string          `json:"rank"`
	Threshold float64         `json:"threshold"`
	Profiles  []KrakenProfile `json:"profiles"`
}
type KrakenProfile struct {
	Sample       int           `json:"sample"`
	Report       string        `json:"report"`
	Total        uint64        `json:"total"`
	Unclassified uint64        `json:"unclassified"`
	Taxa         []KrakenTaxon `json:"taxa"`
}
type KrakenTaxon struct {
	TaxID   string  `json:"taxid"`
	Name    string  `json:"name"`
	Clade   uint64  `json:"clade"`
	Direct  uint64  `json:"direct"`
	Percent float64 `json:"percent"`
}

var krakenFields = []string{"kraken_taxon", "kraken_taxid", "kraken_percent", "kraken_clade_fragments", "kraken_direct_fragments", "kraken_total_fragments", "kraken_sample_id"}
var krakenRankPattern = regexp.MustCompile(`^[URDKPCOFGS][0-9]*$`)

func krakenRank(raw string) (string, error) {
	for code, name := range map[string]string{"D": "domain", "K": "kingdom", "P": "phylum", "C": "class", "O": "order", "F": "family", "G": "genus", "S": "species"} {
		if strings.EqualFold(raw, code) || strings.EqualFold(raw, name) {
			return code, nil
		}
	}
	return "", errors.New("taxonomic rank must be D, K, P, C, O, F, G or S (or its full name)")
}

func krakenReportStem(name string) string {
	// Longest suffixes first; retain the original filename as an exact-match option.
	for _, suffix := range []string{".kraken2.report.txt", ".kraken2.report.tsv", "_kraken2_report.txt", "_kraken2_report.tsv", ".kraken2.report", ".kraken.report", ".kreport.txt", ".kreport.tsv", ".report.txt", ".report.tsv", "_report.txt", "_report.tsv", ".kreport", ".report", ".kraken2", ".kraken", ".tsv", ".txt"} {
		if strings.HasSuffix(strings.ToLower(name), suffix) {
			return name[:len(name)-len(suffix)]
		}
	}
	return ""
}

func loadKrakenReports(dir, requestedRank string, threshold float64, d *spaceTimeData) error {
	rank, err := krakenRank(requestedRank)
	if err != nil {
		return err
	}
	for _, field := range krakenFields {
		if containsString(d.Headers, field) {
			return fmt.Errorf("metadata column %q is reserved for imported Kraken values", field)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read Kraken report folder: %w", err)
	}
	match := spaceIDMatcher(d.Observations)
	// Optional metadata mappings are filenames, not paths to read outside the folder.
	explicit := map[string]int{}
	exactIDs := map[string]int{}
	for i, o := range d.Observations {
		exactIDs[o.ID] = i
		name := o.Metadata["kraken_report"]
		if spaceMissing(name) {
			continue
		}
		if filepath.Base(name) != name || strings.ContainsAny(name, "/\\") {
			return fmt.Errorf("kraken_report for %q must be a filename within the report folder", o.ID)
		}
		if _, exists := explicit[name]; exists {
			return fmt.Errorf("Kraken report %q assigned to multiple samples", name)
		}
		explicit[name] = i
	}
	community := &KrakenCommunity{Rank: rank, Threshold: threshold, Profiles: []KrakenProfile{}}
	matched := map[int]bool{}
	names := map[string]string{}
	ignored := []string{}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if !entry.Type().IsRegular() {
			ignored = append(ignored, name+" (not a regular file; subfolders are not scanned)")
			continue
		}
		i, mapped := explicit[name]
		if !mapped {
			stem := krakenReportStem(name)
			if stem == "" {
				ignored = append(ignored, name+" (unsupported suffix)")
				continue
			}
			// A full exact filename ID takes precedence over its suffix-stripped alias.
			var exact bool
			i, exact = exactIDs[name]
			if !exact {
				i, err = match(stem)
				if err != nil {
					return err
				}
			}
			if i >= 0 && !spaceMissing(d.Observations[i].Metadata["kraken_report"]) {
				ignored = append(ignored, name+" (sample has an explicit kraken_report mapping)")
				continue
			}
		}
		if i < 0 {
			ignored = append(ignored, name+" (no matching mapped sample)")
			continue
		}
		if matched[i] {
			return fmt.Errorf("multiple Kraken reports match sample %q; set kraken_report in metadata to choose one", d.Observations[i].ID)
		}
		file, e := os.Open(filepath.Join(dir, name))
		if e != nil {
			return e
		}
		profile, e := parseKrakenReport(file, rank)
		closeErr := file.Close()
		if e != nil {
			return fmt.Errorf("Kraken report %s: %w", name, e)
		}
		if closeErr != nil {
			return closeErr
		}
		profile.Sample, profile.Report = i, name
		for _, taxon := range profile.Taxa {
			if existing, ok := names[taxon.TaxID]; ok && existing != taxon.Name {
				return fmt.Errorf("taxid %s has inconsistent names across reports (%q / %q); use a consistent taxonomy", taxon.TaxID, existing, taxon.Name)
			}
			names[taxon.TaxID] = taxon.Name
		}
		community.Profiles = append(community.Profiles, profile)
		matched[i] = true
	}
	if len(community.Profiles) == 0 {
		return errors.New("no Kraken reports matched usable metadata; name reports SAMPLE_ID.kreport or specify a kraken_report filename column")
	}
	sort.Slice(community.Profiles, func(i, j int) bool { return community.Profiles[i].Sample < community.Profiles[j].Sample })
	missing := []string{}
	for i, o := range d.Observations {
		if !matched[i] {
			missing = append(missing, o.ID)
		}
	}
	if len(missing) > 0 {
		d.Warnings = append(d.Warnings, "Mapped samples without a Kraken report (missing data, not zero abundance): "+strings.Join(missing, ", "))
	}
	if len(ignored) > 0 {
		d.Warnings = append(d.Warnings, "Ignored Kraken-folder entries: "+strings.Join(ignored, ", "))
	}
	d.Warnings = append(d.Warnings, "Kraken proportions = clade fragments / (classified root + unclassified fragments), at a single exact taxonomic rank. These are classification proportions, not Bracken estimates or absolute concentrations. Use consistently processed, complete sample reports from the same database; database-inspection reports have the same layout and cannot be identified reliably from these columns.")
	d.Community = community
	d.Headers = append(d.Headers, krakenFields...)
	return nil
}

func parseKrakenReport(input io.Reader, rank string) (KrakenProfile, error) {
	profile := KrakenProfile{Taxa: []KrakenTaxon{}}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	type row struct {
		percent           float64
		clade, direct     uint64
		rank, taxid, name string
	}
	rows := []row{}
	seen := map[string]bool{}
	rootFound, unclassifiedFound := false, false
	var classified uint64
	const safeInteger = uint64(1<<53 - 1)
	count := func(s string) (uint64, error) {
		v, e := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
		if e != nil || v > safeInteger {
			return 0, errors.New("counts must be nonnegative integers representable exactly in the browser")
		}
		return v, nil
	}
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimPrefix(scanner.Text(), "\ufeff")
		if strings.TrimSpace(text) == "" {
			continue
		}
		fields := strings.Split(text, "\t")
		if len(fields) != 6 && len(fields) != 8 {
			return profile, fmt.Errorf("line %d: expected a 6- or 8-column Kraken2 sample report; per-read output, MPA and Bracken tables are not supported by this importer", line)
		}
		for i := range fields {
			fields[i] = strings.TrimSpace(fields[i])
		}
		p, e := strconv.ParseFloat(fields[0], 64)
		if e != nil || math.IsNaN(p) || math.IsInf(p, 0) || p < 0 || p > 100 {
			return profile, fmt.Errorf("line %d: invalid percentage", line)
		}
		clade, e := count(fields[1])
		if e != nil {
			return profile, fmt.Errorf("line %d: %w", line, e)
		}
		direct, e := count(fields[2])
		if e != nil || direct > clade {
			return profile, fmt.Errorf("line %d: invalid direct/clade counts", line)
		}
		rankIndex := len(fields) - 3
		if len(fields) == 8 {
			for _, v := range fields[3:5] {
				if _, e := count(v); e != nil {
					return profile, fmt.Errorf("line %d: invalid minimizer count", line)
				}
			}
		}
		r, taxid, name := fields[rankIndex], fields[rankIndex+1], fields[rankIndex+2]
		id, e := count(taxid)
		if e != nil || strconv.FormatUint(id, 10) != taxid || name == "" || !krakenRankPattern.MatchString(r) {
			return profile, fmt.Errorf("line %d: invalid rank, taxid or name", line)
		}
		if seen[taxid] {
			return profile, fmt.Errorf("line %d: duplicate taxid %s", line, taxid)
		}
		seen[taxid] = true
		if r == "R" {
			if taxid != "1" {
				return profile, errors.New("root row must have taxid 1")
			}
			classified = clade
			rootFound = true
		}
		if r == "U" {
			if taxid != "0" || direct != clade {
				return profile, errors.New("invalid unclassified row")
			}
			profile.Unclassified = clade
			unclassifiedFound = true
		}
		if (taxid == "0" && r != "U") || (taxid == "1" && r != "R") {
			return profile, errors.New("root/unclassified taxid has an inconsistent rank")
		}
		rows = append(rows, row{p, clade, direct, r, taxid, name})
	}
	if err := scanner.Err(); err != nil {
		return profile, err
	}
	if !rootFound && !unclassifiedFound {
		return profile, errors.New("missing root/unclassified totals; use a complete Kraken2 sample report")
	}
	if classified > safeInteger-profile.Unclassified {
		return profile, errors.New("total fragments exceed browser integer precision")
	}
	profile.Total = classified + profile.Unclassified
	if profile.Total == 0 {
		return profile, errors.New("report has zero total fragments; a proportion cannot be calculated")
	}
	var rankTotal uint64
	for _, r := range rows {
		if r.rank != "U" && r.clade > classified {
			return profile, errors.New("taxon clade count exceeds classified root total")
		}
		p := 100 * float64(r.clade) / float64(profile.Total)
		if math.Abs(p-r.percent) > .011 {
			return profile, fmt.Errorf("percentage/count mismatch for taxid %s; report may be incomplete or use a different denominator", r.taxid)
		}
		if r.rank != rank {
			continue
		}
		if r.clade > classified-rankTotal {
			return profile, errors.New("selected-rank clade totals exceed classified fragments")
		}
		rankTotal += r.clade
		profile.Taxa = append(profile.Taxa, KrakenTaxon{r.taxid, r.name, r.clade, r.direct, p})
	}
	sort.Slice(profile.Taxa, func(i, j int) bool {
		if profile.Taxa[i].Clade != profile.Taxa[j].Clade {
			return profile.Taxa[i].Clade > profile.Taxa[j].Clade
		}
		return profile.Taxa[i].TaxID < profile.Taxa[j].TaxID
	})
	return profile, nil
}
