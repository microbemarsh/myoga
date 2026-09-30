package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

//go:embed index.html styles.css src assets example
var appFiles embed.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "space-time" {
		if err := runSpaceTime(os.Args[2:], os.Stdout); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				return
			}
			log.Print(err)
			os.Exit(1)
		}
		return
	}
	host := flag.String("host", "127.0.0.1", "host interface for the local myoga server")
	port := flag.String("port", "0", "port for the local myoga server; 0 chooses an available port")
	noBrowser := flag.Bool("no-browser", false, "start the local server without opening a browser")
	flag.Parse()

	if err := registerMimeTypes(); err != nil {
		log.Printf("mime setup warning: %v", err)
	}

	listener, err := net.Listen("tcp", net.JoinHostPort(*host, *port))
	if err != nil {
		log.Fatalf("could not start myoga server: %v", err)
	}

	appURL := "http://" + listener.Addr().String() + "/"
	server := &http.Server{
		Handler:           localOnly(loggingMiddleware(staticHandler())),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		errs <- server.Serve(listener)
	}()

	fmt.Println("myoga is running locally.")
	fmt.Println(appURL)
	fmt.Println("Close this window or press Ctrl+C to stop myoga.")

	if !*noBrowser {
		if err := openBrowser(appURL); err != nil {
			log.Printf("could not open browser automatically: %v", err)
		}
	}

	if err := <-errs; err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("server stopped: %v", err)
	}

	_ = server.Shutdown(context.Background())
}

func staticHandler() http.Handler {
	content, err := fs.Sub(appFiles, ".")
	if err != nil {
		log.Fatalf("could not prepare embedded app files: %v", err)
	}
	fileServer := http.FileServer(http.FS(content))

	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/space-time") {
			serveSpaceTime(response, request)
			return
		}
		if request.URL.Path == "/" || request.URL.Path == "/index.html" {
			index, err := appFiles.ReadFile("index.html")
			if err != nil {
				http.Error(response, "index.html is not embedded", http.StatusInternalServerError)
				return
			}
			response.Header().Set("Content-Type", "text/html; charset=utf-8")
			response.Header().Set("Content-Length", fmt.Sprint(len(index)))
			if request.Method != http.MethodHead {
				_, _ = response.Write(index)
			}
			return
		}
		if strings.Contains(request.URL.Path, "..") {
			http.Error(response, "invalid path", http.StatusBadRequest)
			return
		}
		fileServer.ServeHTTP(response, request)
	})
}

func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		host, _, err := net.SplitHostPort(request.RemoteAddr)
		if err != nil || !net.ParseIP(host).IsLoopback() {
			http.Error(response, "myoga only accepts local browser connections", http.StatusForbidden)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		log.Printf("%s %s", request.Method, request.URL.Path)
		next.ServeHTTP(response, request)
	})
}

func registerMimeTypes() error {
	var errs []string
	types := map[string]string{
		".css":     "text/css; charset=utf-8",
		".csv":     "text/csv; charset=utf-8",
		".geojson": "application/geo+json",
		".ggr":     "application/octet-stream",
		".js":      "text/javascript; charset=utf-8",
		".json":    "application/json",
		".tree":    "text/plain; charset=utf-8",
	}
	for extension, mediaType := range types {
		if err := mime.AddExtensionType(extension, mediaType); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf(strings.Join(errs, "; "))
	}
	return nil
}

func openBrowser(url string) error {
	var command string
	var args []string

	switch runtime.GOOS {
	case "windows":
		command = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		command = "open"
		args = []string{url}
	default:
		command = "xdg-open"
		args = []string{url}
	}

	path, err := exec.LookPath(command)
	if err != nil {
		return err
	}
	cmd := exec.Command(path, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}
