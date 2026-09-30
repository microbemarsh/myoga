package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Browser and CLI entry points share all parsing, validation and HTML generation.
func serveSpaceTime(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/space-time" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		b, err := appFiles.ReadFile("src/space-time-start.html")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.Method != http.MethodHead {
			_, _ = w.Write(b)
		}
		return
	}
	example := r.URL.Path == "/space-time/example" && r.Method == http.MethodGet
	if !example && (r.URL.Path != "/space-time/generate" || r.Method != http.MethodPost) {
		http.Error(w, "not found or unsupported method", http.StatusNotFound)
		return
	}
	if !example {
		origin, err := url.Parse(r.Header.Get("Origin"))
		if err != nil || origin.Host != r.Host || origin.Scheme != "http" {
			http.Error(w, "same-origin local form submission required", http.StatusForbidden)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 256<<20)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			http.Error(w, "invalid upload or upload exceeds 256 MiB", http.StatusBadRequest)
			return
		}
		defer r.MultipartForm.RemoveAll()
	}
	dir, err := os.MkdirTemp("", "myoga-space-time-*")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer os.RemoveAll(dir)
	output := filepath.Join(dir, "surveillance_4d.html")
	args := []string{"--output", output}
	for _, name := range []string{"metadata", "distances", "clusters"} {
		path := filepath.Join(dir, name+".tsv")
		if example {
			if name == "clusters" {
				continue
			}
			b, err := appFiles.ReadFile("example/space-time/" + name + ".tsv")
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			if err = os.WriteFile(path, b, 0600); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		} else {
			input, _, err := r.FormFile(name)
			if err == http.ErrMissingFile && name != "metadata" {
				continue
			}
			if err != nil {
				http.Error(w, fmt.Sprintf("missing or invalid %s file", name), 400)
				return
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				input.Close()
				http.Error(w, err.Error(), 500)
				return
			}
			_, copyErr := io.Copy(file, input)
			input.Close()
			closeErr := file.Close()
			if copyErr != nil || closeErr != nil {
				http.Error(w, "could not save local upload", 500)
				return
			}
		}
		args = append(args, "--"+name, path)
	}
	if !example {
		if reports := r.MultipartForm.File["kraken-reports"]; len(reports) > 0 {
			reportDir := filepath.Join(dir, "kraken-reports")
			if err := os.Mkdir(reportDir, 0700); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			for _, upload := range reports {
				name := upload.Filename
				if name == "" || name == "." || name == ".." || filepath.Base(name) != name || strings.ContainsAny(name, "/\\") {
					http.Error(w, "Kraken report filenames must be unique plain filenames", 400)
					return
				}
				input, err := upload.Open()
				if err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				file, err := os.OpenFile(filepath.Join(reportDir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
				if err != nil {
					input.Close()
					http.Error(w, "duplicate or invalid Kraken filename: "+name, 400)
					return
				}
				_, copyErr := io.Copy(file, input)
				input.Close()
				closeErr := file.Close()
				if copyErr != nil || closeErr != nil {
					http.Error(w, "could not save Kraken upload", 500)
					return
				}
			}
			args = append(args, "--kraken-reports", reportDir)
			for _, name := range []string{"taxonomic-rank", "abundance-threshold"} {
				if value := r.FormValue(name); value != "" {
					args = append(args, "--"+name, value)
				}
			}
		}
		for _, name := range []string{"id-column", "lat-column", "lon-column", "time-column", "color-by", "distance-label"} {
			if value := r.FormValue(name); value != "" {
				args = append(args, "--"+name, value)
			}
		}
	}
	if err := runSpaceTime(args, io.Discard); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="surveillance_4d.html"`)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, output)
}
