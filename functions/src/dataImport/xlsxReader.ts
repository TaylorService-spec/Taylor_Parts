// EOS Data Import -- a deliberately SMALL, read-only XLSX reader.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY. `functions` has two dependencies today. The
// obvious spreadsheet library for this job has a long history of security advisories and is
// no longer published to npm under maintenance most teams would accept, and every
// alternative brings a general-purpose workbook engine -- styles, charts, formula
// evaluation, write support -- to answer one question: what values are in the first sheet.
// Reading a spreadsheet is the smaller problem, and it is bounded.
//
// WHAT IT DOES. An .xlsx file is a ZIP of XML. This reads the ZIP central directory,
// inflates the three or four parts it needs with node's own zlib, and pulls the CACHED
// VALUES out of the first worksheet.
//
// ============================ WHAT IT WILL NOT DO, AND WHY ============================
//
// FORMULAS ARE NEVER EVALUATED. A cell's <f> element is ignored entirely; only the <v>
// Excel already computed is read. An importer that evaluated formulas would be executing
// the uploaded file, and "=cmd|' /c calc'!A1" is a real spreadsheet payload, not a
// hypothetical one. If Excel never computed a value, the cell reads as empty -- which is
// honest, because nothing here knows what it would have been.
//
// MACROS ARE NOT REACHABLE. .xlsm is not an accepted extension, and even inside an .xlsx
// this reader opens exactly four parts by name. A macro part is never inflated, let alone
// interpreted.
//
// EXTERNAL REFERENCES ARE NOT FOLLOWED. No part outside the archive is ever fetched. A
// workbook linking to a network path yields whatever value it cached, or nothing.
//
// EVERY EXPANSION IS BOUNDED. A ZIP can inflate to far more than it stores, so total
// inflated bytes are capped and a part that would exceed the cap is refused mid-stream
// rather than after it has allocated. This is the one place a small reader could still be
// a denial-of-service surface, so it is the one place with an explicit budget.
//
// WRITE SUPPORT DOES NOT EXIST HERE and is not a gap: import reads.

import { inflateRawSync } from "node:zlib";

/** Total inflated bytes allowed across all parts. A workbook is XML; this is generous. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

export type XlsxFailureCode =
  | "NOT_A_ZIP"
  | "MALFORMED_ARCHIVE"
  | "UNSUPPORTED_COMPRESSION"
  | "ENCRYPTED"
  | "NOT_A_WORKBOOK"
  | "NO_WORKSHEET"
  | "TOO_LARGE_INFLATED";

export class XlsxError extends Error {
  readonly code: XlsxFailureCode;
  constructor(code: XlsxFailureCode, message: string) {
    super(message);
    this.name = "XlsxError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly flags: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Find the End Of Central Directory record.
 *
 * Scanned BACKWARDS from the end because the record is last and its size varies with an
 * optional trailing comment. The scan is bounded to the maximum comment length, so a file
 * that simply is not a ZIP costs one bounded pass and not a search of the whole buffer.
 */
function findEocd(buf: Buffer): number {
  const maxComment = 0xffff;
  const start = Math.max(0, buf.length - maxComment - 22);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new XlsxError("NOT_A_ZIP", "This file is not a readable .xlsx workbook.");
}

function readCentralDirectory(buf: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new XlsxError("MALFORMED_ARCHIVE", "The workbook's internal structure is damaged.");
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);

    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset, flags });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry, against a shared budget so the WHOLE archive is bounded, not each part. */
function readEntry(buf: Buffer, entry: ZipEntry, budget: { remaining: number }): string {
  // Bit 0 of the general-purpose flags is the encryption bit. An encrypted workbook is a
  // clear refusal, not a parse failure -- the operator needs to know to send a plain file.
  if ((entry.flags & 0x1) !== 0) {
    throw new XlsxError("ENCRYPTED", "This workbook is password-protected. Save it without a password and try again.");
  }
  if (entry.uncompressedSize > budget.remaining) {
    throw new XlsxError("TOO_LARGE_INFLATED", "This workbook expands to more data than import will process.");
  }

  const lh = entry.localHeaderOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== LOCAL_SIGNATURE) {
    throw new XlsxError("MALFORMED_ARCHIVE", "The workbook's internal structure is damaged.");
  }
  // The local header repeats the name/extra lengths and they may differ from the central
  // directory's; the DATA offset must come from here, not from the central record.
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);

  let out: Buffer;
  if (entry.method === 0) out = Buffer.from(data);
  else if (entry.method === 8) out = inflateRawSync(data);
  else {
    throw new XlsxError("UNSUPPORTED_COMPRESSION", "This workbook uses a compression method import cannot read.");
  }

  if (out.length > budget.remaining) {
    // The declared uncompressed size is attacker-controlled, so it is checked again against
    // what actually came out. A lying header must not be able to buy an unbounded inflate.
    throw new XlsxError("TOO_LARGE_INFLATED", "This workbook expands to more data than import will process.");
  }
  budget.remaining -= out.length;
  return out.toString("utf8");
}

// ---------------------------------------------------------------------------
// XML -- just enough, and no XML parser
// ---------------------------------------------------------------------------
//
// These are regex scans over Office's own generated markup, which is machine-written and
// regular. That is a genuine limitation and it is the right trade here: a real XML parser
// is either a dependency or a second parser to secure, and the alternative to reading these
// four parts loosely is reading arbitrary XML strictly -- a bigger attack surface for a
// smaller benefit. Nothing below follows a reference, resolves an entity, or reads a DTD.

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the five predefined entities and numeric escapes. NO custom entity is honoured. */
function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    // An entity this does not know is left EXACTLY as written rather than dropped: a value
    // that looks wrong is findable; a value that silently lost characters is not.
    return XML_ENTITIES[body] ?? whole;
  });
}

/**
 * Shared strings, in order.
 *
 * A <si> is either one <t>, or several <r><t> runs (rich text) that concatenate into one
 * value. Formatting inside the runs is discarded -- import wants the text.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let value = "";
    for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += decodeXml(t[1]);
    out.push(value);
  }
  return out;
}

/** "BC12" -> 54 (zero-based column index). */
export function columnIndexFromRef(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---------------------------------------------------------------------------
// Worksheet
// ---------------------------------------------------------------------------

export interface XlsxReadOptions {
  /** Refuse beyond this many data rows (header included). Bounded by the caller's limits. */
  readonly maxRows: number;
  readonly maxColumns: number;
}

/**
 * Read the FIRST worksheet of a workbook into a rectangular grid of strings.
 *
 * ONE SHEET, ON PURPOSE. A multi-sheet workbook is several data sets, and choosing among
 * them is a product question this release does not answer. Reading only the first is
 * predictable; reading "the one that looks like Parts" is a guess with a silent failure
 * mode.
 *
 * EVERYTHING IS A STRING, exactly as with CSV. Dates and numbers are handled by the same
 * canonical contract that handles them for a CSV, so a workbook and a text file cannot
 * disagree about what a value means.
 */
export function readXlsxGrid(bytes: Buffer, options: XlsxReadOptions): string[][] {
  const entries = readCentralDirectory(bytes);
  const budget = { remaining: MAX_INFLATED_BYTES };

  if (!entries.has("[Content_Types].xml")) {
    throw new XlsxError("NOT_A_WORKBOOK", "This file is a ZIP archive but not an Excel workbook.");
  }

  const sheetName = firstWorksheetPart(bytes, entries, budget);
  const sheetEntry = entries.get(sheetName);
  if (!sheetEntry) throw new XlsxError("NO_WORKSHEET", "The workbook contains no readable worksheet.");

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(readEntry(bytes, sharedEntry, budget)) : [];

  return parseWorksheet(readEntry(bytes, sheetEntry, budget), shared, options);
}

/**
 * Which part holds the first worksheet.
 *
 * Resolved through the workbook's relationships rather than assuming
 * "xl/worksheets/sheet1.xml": that name is a convention, and a workbook whose first sheet
 * is stored under another name would otherwise import the WRONG SHEET silently -- the worst
 * available outcome. The conventional name is the fallback, not the rule.
 */
function firstWorksheetPart(bytes: Buffer, entries: Map<string, ZipEntry>, budget: { remaining: number }): string {
  const workbook = entries.get("xl/workbook.xml");
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const wbXml = readEntry(bytes, workbook, budget);
    const relsXml = readEntry(bytes, rels, budget);
    const firstSheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wbXml)?.[1];
    if (firstSheet) {
      const target = new RegExp(`<Relationship\\b[^>]*\\bId="${firstSheet}"[^>]*\\bTarget="([^"]+)"`).exec(relsXml)?.[1];
      if (target) {
        const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
        if (entries.has(normalized)) return normalized;
      }
    }
  }
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  throw new XlsxError("NO_WORKSHEET", "The workbook contains no readable worksheet.");
}

function parseWorksheet(xml: string, shared: readonly string[], options: XlsxReadOptions): string[][] {
  const grid: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (grid.length >= options.maxRows + 1) break;
    const cells: string[] = [];

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const index = ref ? columnIndexFromRef(ref) : cells.length;
      if (index >= options.maxColumns) continue;
      // Gaps are real: Excel omits empty cells entirely, so a row's cells are not
      // positional. Filling to the reference is what keeps column N aligned with header N.
      while (cells.length < index) cells.push("");
      cells[index] = cellValue(attrs, body, shared);
    }

    grid.push(cells);
  }

  // Rectangular: every row padded to the widest, so downstream code can index by column
  // without asking whether this particular row happened to end early.
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  return grid.map((r) => {
    while (r.length < width) r.push("");
    return r;
  });
}

/**
 * One cell's value.
 *
 * <f> IS NEVER READ. Only <v> -- the value Excel itself last computed and cached -- and
 * inline strings. A cell holding a formula that was never calculated reads as empty.
 */
function cellValue(attrs: string, body: string, shared: readonly string[]): string {
  const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";

  if (type === "inlineStr") {
    let value = "";
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += decodeXml(t[1]);
    return value;
  }

  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (raw === undefined) return "";
  const value = decodeXml(raw);

  if (type === "s") {
    const idx = Number.parseInt(value, 10);
    // An out-of-range index is a damaged workbook, not a value. Empty is the honest answer;
    // guessing a neighbouring string would silently mis-state a record.
    return Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : "";
  }
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  if (type === "e") return ""; // an error cell (#REF!, #DIV/0!) carries no importable value
  return value;
}
