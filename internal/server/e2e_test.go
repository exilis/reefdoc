package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestE2E_EndpointsOverHTTP(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "doc.md"), []byte("# Title"), 0o644); err != nil {
		t.Fatal(err)
	}
	assets := fstest.MapFS{"index.html": {Data: []byte("<p>app</p>")}}
	srv := httptest.NewServer(New(root, NewBroker(), assets, nil).Handler())
	defer srv.Close()

	cases := []struct {
		path            string
		wantStatus      int
		wantSub         string
		wantDisposition string // expected Content-Disposition; "" means must be absent
	}{
		{"/", 200, "app", ""},
		{"/api/tree", 200, "doc.md", ""},
		{"/api/file?path=doc.md", 200, "# Title", ""},
		{"/api/file?path=missing.md", 404, "", ""},
		{"/api/file?path=../escape", 400, "", ""},
		// Download mode: the same file API, over real HTTP, must add the
		// attachment header so the browser saves rather than renders.
		{"/api/file?path=doc.md&download=1", 200, "# Title", `attachment; filename="doc.md"`},
	}
	for _, c := range cases {
		resp, err := http.Get(srv.URL + c.path)
		if err != nil {
			t.Fatalf("%s: %v", c.path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != c.wantStatus {
			t.Errorf("%s: status %d want %d", c.path, resp.StatusCode, c.wantStatus)
		}
		if c.wantSub != "" && !strings.Contains(string(body), c.wantSub) {
			t.Errorf("%s: body %q missing %q", c.path, body, c.wantSub)
		}
		if got := resp.Header.Get("Content-Disposition"); got != c.wantDisposition {
			t.Errorf("%s: Content-Disposition %q want %q", c.path, got, c.wantDisposition)
		}
	}
}
