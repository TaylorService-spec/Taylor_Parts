// EOS Data Import P1 -- the dependency-free XLSX reader.
//
// The workbooks are BUILT HERE, byte by byte, with node's own zlib. No spreadsheet library
// is used to produce the fixtures, which matters twice over: the tests add no dependency to
// the thing whose whole point is having none, and a hand-built archive can be made
// deliberately hostile in ways a library would refuse to emit -- a lying size header, a
// formula with no cached value, a shared-string index off the end of the table.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { readXlsxGrid, XlsxError, columnIndexFromRef } from "../lib/dataImport/xlsxReader.js";

const LIMITS = { maxRows: 5000, maxColumns: 100 };

// --------------------------------------------------------------- a minimal ZIP writer

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * Build a ZIP. `overrides` can corrupt a single entry on purpose -- that is what lets a
 * malformed-archive test be about the reader rather than about a library's error message.
 */
function zip(files, overrides = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, contentStr] of Object.entries(files)) {
    const content = Buffer.from(contentStr, "utf8");
    const deflated = deflateRawSync(content);
    const nameBuf = Buffer.from(name, "utf8");
    const o = overrides[name] ?? {};

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(o.flags ?? 0, 6);
    local.writeUInt16LE(o.method ?? 8, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(o.uncompressedSize ?? content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(o.flags ?? 0, 8);
    cd.writeUInt16LE(o.method ?? 8, 10);
    cd.writeUInt32LE(crc32(content), 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(o.uncompressedSize ?? content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + deflated.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types/>';
const WORKBOOK = '<workbook><sheets><sheet name="Parts" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';

function workbook(sheetXml, { shared = null, sheetPath = "xl/worksheets/sheet1.xml", rels = RELS } = {}) {
  const files = {
    "[Content_Types].xml": CONTENT_TYPES,
    "xl/workbook.xml": WORKBOOK,
    "xl/_rels/workbook.xml.rels": rels,
    [sheetPath]: sheetXml,
  };
  if (shared) files["xl/sharedStrings.xml"] = shared;
  return zip(files);
}

const sheet = (rows) => `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;

// --------------------------------------------------------------- reading values

test("a workbook of shared strings reads as a grid, header first", () => {
  const shared = "<sst><si><t>PART_NO</t></si><si><t>NAME</t></si><si><t>TST-1</t></si><si><t>Gasket</t></si></sst>";
  const bytes = workbook(
    sheet([
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>',
    ]),
    { shared },
  );

  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [
    ["PART_NO", "NAME"],
    ["TST-1", "Gasket"],
  ]);
});

test("numbers, booleans and inline strings all read as strings, like a CSV", () => {
  const bytes = workbook(
    sheet([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>QTY</t></is></c><c r="B1" t="inlineStr"><is><t>ACTIVE</t></is></c></row>',
      '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="b"><v>1</v></c></row>',
    ]),
  );
  // Everything is a string because the canonical contract owns interpretation. If a
  // workbook produced numbers and a CSV produced strings, the two formats would disagree
  // about what a value means -- for the same file, exported twice.
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [
    ["QTY", "ACTIVE"],
    ["42", "TRUE"],
  ]);
});

test("a rich-text cell concatenates its runs and drops the formatting", () => {
  const shared = "<sst><si><r><t>PART</t></r><r><t>_NO</t></r></si></sst>";
  const bytes = workbook(sheet(['<row r="1"><c r="A1" t="s"><v>0</v></c></row>']), { shared });
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [["PART_NO"]]);
});

test("XML entities are decoded, and an entity the reader does not know is left visible", () => {
  const bytes = workbook(
    sheet(['<row r="1"><c r="A1" t="inlineStr"><is><t>A &amp; B &lt;C&gt; &#65; &nope;</t></is></c></row>']),
  );
  // The unknown entity survives verbatim rather than vanishing: a value that looks wrong is
  // findable in a preview; a value that silently lost characters is not.
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [["A & B <C> A &nope;"]]);
});

// --------------------------------------------------------------- formulas

test("a formula is NEVER evaluated -- only the value Excel already cached is read", () => {
  const bytes = workbook(
    sheet([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>TOTAL</t></is></c></row>',
      '<row r="2"><c r="A2"><f>SUM(B1:B9)</f><v>7</v></c></row>',
      // A formula Excel never computed. There is no cached value, so there is no value.
      '<row r="3"><c r="A3"><f>cmd|\' /c calc\'!A0</f></c></row>',
    ]),
  );
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [["TOTAL"], ["7"], [""]]);
});

test("an error cell carries no importable value", () => {
  const bytes = workbook(sheet(['<row r="1"><c r="A1" t="e"><v>#REF!</v></c></row>']));
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [[""]]);
});

// --------------------------------------------------------------- alignment

test("omitted cells are filled from the cell reference, so columns stay aligned", () => {
  const bytes = workbook(
    sheet([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c><c r="B1" t="inlineStr"><is><t>B</t></is></c><c r="C1" t="inlineStr"><is><t>C</t></is></c></row>',
      // Excel omits empty cells entirely. Without honouring r=, "z" would land in column B
      // and every value beneath a gap would be misfiled -- silently.
      '<row r="2"><c r="C2" t="inlineStr"><is><t>z</t></is></c></row>',
    ]),
  );
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [
    ["A", "B", "C"],
    ["", "", "z"],
  ]);
});

test("column references beyond Z resolve correctly", () => {
  assert.equal(columnIndexFromRef("A1"), 0);
  assert.equal(columnIndexFromRef("Z9"), 25);
  assert.equal(columnIndexFromRef("AA1"), 26);
  assert.equal(columnIndexFromRef("BC12"), 54);
});

test("the first worksheet is found through the RELATIONSHIP, not by assuming a filename", () => {
  const bytes = workbook(sheet(['<row r="1"><c r="A1" t="inlineStr"><is><t>OK</t></is></c></row>']), {
    sheetPath: "xl/worksheets/renamed.xml",
    rels: '<Relationships><Relationship Id="rId1" Target="worksheets/renamed.xml"/></Relationships>',
  });
  // Assuming sheet1.xml would import the WRONG SHEET from a workbook that stores its first
  // sheet elsewhere, which is the worst available outcome: plausible data, silently wrong.
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [["OK"]]);
});

// --------------------------------------------------------------- limits

test("a row cap stops reading rather than materializing the whole sheet", () => {
  const rows = Array.from({ length: 50 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`);
  const grid = readXlsxGrid(workbook(sheet(rows)), { maxRows: 10, maxColumns: 100 });
  assert.equal(grid.length, 11, "the header plus the cap");
});

test("cells beyond the column cap are dropped, not silently shifted left", () => {
  const bytes = workbook(
    sheet(['<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row>']),
  );
  assert.deepEqual(readXlsxGrid(bytes, { maxRows: 10, maxColumns: 2 }), [["1", "2"]]);
});

// --------------------------------------------------------------- malformed and hostile

test("a file that is not a ZIP is refused by code, not by a crash", () => {
  assert.throws(
    () => readXlsxGrid(Buffer.from("PART_NO,NAME\nTST-1,Gasket\n", "utf8"), LIMITS),
    (err) => err instanceof XlsxError && err.code === "NOT_A_ZIP",
  );
});

test("a ZIP that is not a workbook is a DIFFERENT refusal from a damaged one", () => {
  assert.throws(
    () => readXlsxGrid(zip({ "readme.txt": "hello" }), LIMITS),
    (err) => err instanceof XlsxError && err.code === "NOT_A_WORKBOOK",
  );
});

test("a password-protected workbook says so, instead of failing as damaged", () => {
  const bytes = zip(
    {
      "[Content_Types].xml": CONTENT_TYPES,
      "xl/workbook.xml": WORKBOOK,
      "xl/_rels/workbook.xml.rels": RELS,
      "xl/worksheets/sheet1.xml": sheet([]),
    },
    { "xl/worksheets/sheet1.xml": { flags: 0x1 } },
  );
  assert.throws(
    () => readXlsxGrid(bytes, LIMITS),
    // The operator can act on this one: save it without a password. "Damaged" would send
    // them looking for a corruption that is not there.
    (err) => err instanceof XlsxError && err.code === "ENCRYPTED" && /password/i.test(err.message),
  );
});

test("an unsupported compression method is refused rather than misread", () => {
  const bytes = zip(
    {
      "[Content_Types].xml": CONTENT_TYPES,
      "xl/workbook.xml": WORKBOOK,
      "xl/_rels/workbook.xml.rels": RELS,
      "xl/worksheets/sheet1.xml": sheet([]),
    },
    { "xl/worksheets/sheet1.xml": { method: 14 } },
  );
  assert.throws(
    () => readXlsxGrid(bytes, LIMITS),
    (err) => err instanceof XlsxError && err.code === "UNSUPPORTED_COMPRESSION",
  );
});

test("a LYING uncompressed-size header cannot buy an unbounded inflate", () => {
  // The declared size is attacker-controlled. A reader that trusted it would refuse the
  // honest 64MB check and then inflate whatever actually came out.
  const bytes = zip(
    {
      "[Content_Types].xml": CONTENT_TYPES,
      "xl/workbook.xml": WORKBOOK,
      "xl/_rels/workbook.xml.rels": RELS,
      "xl/worksheets/sheet1.xml": sheet([]),
    },
    { "xl/worksheets/sheet1.xml": { uncompressedSize: 0xfffffff0 } },
  );
  assert.throws(
    () => readXlsxGrid(bytes, LIMITS),
    (err) => err instanceof XlsxError && err.code === "TOO_LARGE_INFLATED",
  );
});

test("a workbook whose worksheet part is missing is refused, not read as empty", () => {
  const bytes = zip({
    "[Content_Types].xml": CONTENT_TYPES,
    "xl/workbook.xml": WORKBOOK,
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/gone.xml"/></Relationships>',
  });
  // An empty grid would read as "the file had no rows", which is a different and wrong fact.
  assert.throws(
    () => readXlsxGrid(bytes, LIMITS),
    (err) => err instanceof XlsxError && err.code === "NO_WORKSHEET",
  );
});

test("a shared-string index off the end of the table yields empty, never a neighbouring value", () => {
  const bytes = workbook(sheet(['<row r="1"><c r="A1" t="s"><v>99</v></c></row>']), {
    shared: "<sst><si><t>only</t></si></sst>",
  });
  assert.deepEqual(readXlsxGrid(bytes, LIMITS), [[""]]);
});

test("an empty worksheet reads as an empty grid without throwing", () => {
  assert.deepEqual(readXlsxGrid(workbook(sheet([])), LIMITS), []);
});

// --------------------------------------------------------------- intake integration
//
// The reader's own behaviour is above. What follows is the claim that matters more: once
// the bytes are a grid, a workbook and a CSV are THE SAME PROBLEM. Every file-level rule
// runs identically for both, because only the first step differs.

const { parseWorkbookFile, parseSourceFile, IntakeError } = await import("../lib/dataImport/importIntake.js");

const HEADER_ROW = (names) =>
  `<row r="1">${names.map((n, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${n}</t></is></c>`).join("")}</row>`;
const DATA_ROW = (r, values) =>
  `<row r="${r}">${values.map((v, i) => `<c r="${String.fromCharCode(65 + i)}${r}" t="inlineStr"><is><t>${v}</t></is></c>`).join("")}</row>`;

test("a workbook and a CSV of the same content parse to the SAME ParsedSourceFile", () => {
  const columns = ["PART_NO", "NAME"];
  const fromCsv = parseSourceFile("parts.csv", "PART_NO,NAME\nTST-1,Gasket\nTST-2,Switch\n");
  const fromXlsx = parseWorkbookFile(
    "parts.xlsx",
    workbook(sheet([HEADER_ROW(columns), DATA_ROW(2, ["TST-1", "Gasket"]), DATA_ROW(3, ["TST-2", "Switch"])])),
  );

  // Identical, field for field, including the source row numbers an operator is shown.
  assert.deepEqual(fromXlsx.columns, fromCsv.columns);
  assert.deepEqual(fromXlsx.rows, fromCsv.rows);
  assert.deepEqual(fromXlsx.sourceRowNumbers, fromCsv.sourceRowNumbers);
});

test("the header rules apply to a workbook exactly as they do to a CSV", () => {
  assert.throws(
    () => parseWorkbookFile("parts.xlsx", workbook(sheet([HEADER_ROW(["PART_NO", "part_no"])]))),
    (err) => err instanceof IntakeError && err.code === "DUPLICATE_COLUMN",
  );
});

test("trailing formatted-but-empty rows are dropped -- workbooks are full of them", () => {
  const parsed = parseWorkbookFile(
    "parts.xlsx",
    workbook(
      sheet([
        HEADER_ROW(["PART_NO", "NAME"]),
        DATA_ROW(2, ["TST-1", "Gasket"]),
        // A stray format applied to a far-down row makes Excel emit it with empty cells.
        '<row r="900"><c r="A900" t="inlineStr"><is><t></t></is></c></row>',
      ]),
    ),
  );
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.sourceRowNumbers, [2]);
});

test(".xlsm is refused at the extension, before a single byte is inflated", () => {
  assert.throws(
    () => parseWorkbookFile("macros.xlsm", workbook(sheet([HEADER_ROW(["PART_NO"])]))),
    (err) => err instanceof IntakeError && err.code === "UNSUPPORTED_EXTENSION",
  );
});

test("a reader refusal reaches the caller as ONE error type, keeping the actionable message", () => {
  assert.throws(
    () => parseWorkbookFile("parts.xlsx", Buffer.from("not a zip at all", "utf8")),
    // The caller handles IntakeError and nothing else; the reader's own message survives
    // because it describes the operator's file, which is the part they can act on.
    (err) => err instanceof IntakeError && err.code === "UNREADABLE_WORKBOOK" && /not a readable/i.test(err.message),
  );
});

test("each reader refuses what it cannot honestly read", () => {
  // Without this, parseSourceFile would CSV-parse a ZIP's bytes-as-text and produce one
  // column of mojibake instead of an error -- a plausible-looking preview of nothing.
  assert.throws(
    () => parseSourceFile("parts.xlsx", "PART_NO,NAME\nTST-1,Gasket"),
    (err) => err instanceof IntakeError && err.code === "UNSUPPORTED_EXTENSION",
  );
  assert.throws(
    () => parseWorkbookFile("parts.csv", workbook(sheet([HEADER_ROW(["PART_NO"])]))),
    (err) => err instanceof IntakeError && err.code === "UNSUPPORTED_EXTENSION",
  );
});
