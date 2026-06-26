// fixtures.js — shared E2E setup: stub the CDN-loaded PDF viewer so tests run
// offline and can assert on rendered content.
//
// reefdoc's binary viewers (pdfjs-dist, docx-preview, xlsx, pptx-preview) load
// from a CDN via the importmap in index.html. For E2E we don't want to depend on
// third-party CDNs or assert pixel-perfect rendering — we want to verify the
// live-reload PLUMBING (a disk change re-renders the open preview). So we
// intercept the `pdfjs-dist` import and return a tiny fake module that
// implements exactly the API surface web/viewers.js's viewPdf uses, and renders
// the decoded file bytes as visible text we can read back in assertions.
//
// The importmap maps "pdfjs-dist" to
//   https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm
// We route that URL to our fake ES module below.

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm';

// The fake module source. It mirrors viewPdf's usage:
//   pdfjs.GlobalWorkerOptions.workerSrc = ...
//   const doc = await pdfjs.getDocument({ data }).promise   // {numPages, getPage}
//   const page = await doc.getPage(n)                        // {getViewport, render}
//   const viewport = page.getViewport({ scale })             // {width, height}
//   await page.render({ canvasContext, viewport }).promise
//
// Instead of rendering a real PDF, it decodes the bytes to UTF-8 text and
// stamps that text onto the canvas's parent container via a data attribute and
// text node, so the test can read the current preview content. Our fixture PDFs
// are just UTF-8 payloads (the viewer never actually parses PDF structure here).
const FAKE_PDFJS = `
export const GlobalWorkerOptions = { workerSrc: '' };
export function getDocument({ data }) {
  const text = new TextDecoder().decode(new Uint8Array(data));
  return {
    promise: Promise.resolve({
      numPages: 1,
      getPage() {
        return Promise.resolve({
          getViewport: () => ({ width: 200, height: 100 }),
          render: ({ canvasContext }) => {
            // Expose the decoded content where the test can read it: as a
            // data attribute on the canvas and as text in a sibling node.
            const canvas = canvasContext.canvas;
            canvas.setAttribute('data-fake-content', text);
            const marker = document.createElement('pre');
            marker.className = 'fake-pdf-text';
            marker.textContent = text;
            canvas.parentNode.appendChild(marker);
            return { promise: Promise.resolve() };
          },
        });
      },
    }),
  };
}
`;

// installPdfStub routes the pdfjs CDN import to the fake module for a page.
// Call BEFORE navigating so the import is intercepted on first load.
export async function installPdfStub(page) {
  await page.route(PDFJS_CDN, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: FAKE_PDFJS,
    }),
  );
  // Belt-and-suspenders: pdf.js also sets a worker URL; never let it hit the
  // network. Abort any pdf.worker request (the fake never uses it).
  await page.route(/pdf\.worker/, (route) => route.abort());
}
