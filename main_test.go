package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStaticHandlerServesEmbeddedApp(t *testing.T) {
	t.Helper()
	if err := registerMimeTypes(); err != nil {
		t.Fatalf("register MIME types: %v", err)
	}

	tests := []struct {
		name        string
		path        string
		contentType string
		contains    string
	}{
		{name: "index", path: "/", contentType: "text/html; charset=utf-8", contains: `id="mlvamapsExport"`},
		{name: "index alias", path: "/index.html", contentType: "text/html; charset=utf-8", contains: `<title>myoga</title>`},
		{name: "stylesheet", path: "/styles.css", contentType: "text/css; charset=utf-8", contains: ".app-shell"},
		{name: "javascript", path: "/src/myoga.js", contentType: "text/javascript; charset=utf-8", contains: "readMlvamapsExport"},
		{name: "geojson", path: "/assets/ne_50m_admin_0_countries.geojson", contentType: "application/geo+json", contains: `"FeatureCollection"`},
		{name: "example metadata", path: "/example/mers49/metadata.csv", contentType: "text/csv; charset=utf-8", contains: "mers49/Riyadh_1_2012.fna"},
	}

	handler := staticHandler()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d", test.path, response.Code, http.StatusOK)
			}
			if got := response.Header().Get("Content-Type"); got != test.contentType {
				t.Errorf("GET %s Content-Type = %q, want %q", test.path, got, test.contentType)
			}
			if !strings.Contains(response.Body.String(), test.contains) {
				t.Errorf("GET %s body does not contain %q", test.path, test.contains)
			}
		})
	}
}

func TestStaticHandlerHeadAndRejectedPaths(t *testing.T) {
	handler := staticHandler()

	headRequest := httptest.NewRequest(http.MethodHead, "/", nil)
	headResponse := httptest.NewRecorder()
	handler.ServeHTTP(headResponse, headRequest)
	if headResponse.Code != http.StatusOK {
		t.Fatalf("HEAD / returned %d, want %d", headResponse.Code, http.StatusOK)
	}
	if headResponse.Body.Len() != 0 {
		t.Errorf("HEAD / returned %d body bytes, want 0", headResponse.Body.Len())
	}
	if headResponse.Header().Get("Content-Length") == "" {
		t.Error("HEAD / did not return Content-Length")
	}

	tests := []struct {
		name string
		path string
		want int
	}{
		{name: "unembedded source", path: "/go.mod", want: http.StatusNotFound},
		{name: "missing file", path: "/missing.txt", want: http.StatusNotFound},
		{name: "traversal", path: "/../go.mod", want: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Errorf("GET %s returned %d, want %d", test.path, response.Code, test.want)
			}
		})
	}
}

func TestLocalOnly(t *testing.T) {
	next := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	handler := localOnly(next)

	tests := []struct {
		name       string
		remoteAddr string
		want       int
	}{
		{name: "IPv4 loopback", remoteAddr: "127.0.0.1:12345", want: http.StatusNoContent},
		{name: "IPv6 loopback", remoteAddr: "[::1]:12345", want: http.StatusNoContent},
		{name: "non-loopback", remoteAddr: "192.0.2.10:12345", want: http.StatusForbidden},
		{name: "malformed", remoteAddr: "not-an-address", want: http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Errorf("request from %q returned %d, want %d", test.remoteAddr, response.Code, test.want)
			}
		})
	}
}
