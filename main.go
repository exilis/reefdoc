package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"reefdoc/internal/server"
)

//go:embed web/index.html web/app.css web/app.js web/render.js web/tabs.js web/tree.js web/toc.js
var webFS embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	flag.Parse()

	root := "."
	if flag.NArg() > 0 {
		root = flag.Arg(0)
	}
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		log.Fatalf("not a directory: %s", root)
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

	srv := server.New(root, broker, assets)
	fmt.Printf("reefdoc serving %s at http://%s\n", root, *addr)
	log.Fatal(http.ListenAndServe(*addr, srv.Handler()))
}
