package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/exilis/reefdoc/internal/server"
)

//go:embed web/index.html web/app.css web/app.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js
var webFS embed.FS

// version is overridden at release time via -ldflags "-X main.version=<tag>".
var version = "dev"

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("reefdoc", version)
		return
	}

	root := "."
	if flag.NArg() > 0 {
		root = flag.Arg(0)
	}
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		log.Fatalf("not a directory: %s", root)
	}
	root, err := filepath.Abs(root)
	if err != nil {
		log.Fatalf("cannot resolve %s: %v", root, err)
	}

	assets, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	broker := server.NewBroker()
	watcher, err := server.NewWatcher(root, broker)
	if err != nil {
		log.Fatal(err)
	}
	go watcher.Run()
	defer watcher.Close()

	srv := server.New(root, broker, assets, watcher)
	fmt.Printf("reefdoc %s serving %s at http://%s\n", version, root, *addr)
	log.Fatal(http.ListenAndServe(*addr, srv.Handler()))
}
