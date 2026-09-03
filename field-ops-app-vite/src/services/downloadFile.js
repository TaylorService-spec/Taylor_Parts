// DOWNLOAD — hand the operator a file the browser built.
//
// The census for BIN-P5 found no download helper anywhere in the client, so this is the first one.
// It is deliberately tiny and generic rather than CSV-specific: the next caller should not have to
// re-derive object-URL lifetime handling.
//
// NOTHING LEAVES THE BROWSER. No upload, no Cloud Storage, no external service, no persisted
// artifact. The bytes are built in memory from data the user already has on screen and handed
// straight back to them.

/**
 * Trigger a download of in-memory text.
 *
 * The object URL is revoked immediately after the click: the anchor has already read it, and an
 * un-revoked blob URL pins its data in memory for the life of the document.
 */
export function downloadTextFile(filename, text, mimeType = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    // Firefox requires the anchor to be in the document before a synthetic click counts.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** CSV needs its own MIME type so a spreadsheet opens it rather than a text editor. */
export function downloadCsvFile(filename, csv) {
  downloadTextFile(filename, csv, "text/csv;charset=utf-8");
}
