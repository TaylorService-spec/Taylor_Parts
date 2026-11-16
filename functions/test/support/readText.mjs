// Test-only: readFileSync that returns text with LF line endings.
// A Windows checkout (core.autocrlf=true) turns repository text files into CRLF; the tests' \n-only
// regexes and byte-for-byte golden comparisons are written against the committed (LF) form.
// Binary reads (no encoding) are returned untouched. On Linux this is an identity.
import { readFileSync as fsReadFileSync } from "node:fs";

export function readFileSync(path, options) {
  const out = fsReadFileSync(path, options);
  return typeof out === "string" ? out.replace(/\r\n/g, "\n") : out;
}
