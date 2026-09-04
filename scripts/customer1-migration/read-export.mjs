#!/usr/bin/env node
// Export intake reader for gate C1-DATA-01, objective 4 (the stage before the dry run).
//
// The dry-run harness consumes source records already in JSON. Taylor will not
// hand over JSON; Taylor will hand over files. This reader is the seam between
// those two facts: it turns a directory of CSV exports into the harness's
// source-record document, and reports what was wrong with the FILES before a
// single value is mapped or transformed.
//
// It writes nothing and reads nothing outside the directory it is pointed at.
//
// Fail-closed:
//   - a file-level exception yields zero records from that file. The header row
//     is what tells the mapping table which value is which, so a header that
//     does not match the manifest misfiles every value beneath it;
//   - the expected column set is DERIVED from the accepted field mappings, not
//     written down a second time, so it cannot drift away from them;
//   - a column nobody mapped is an exception here too. The export and the
//     mapping table must agree on the column set before any value is read.
//
// SEEDED data proves this process. It does not prove Taylor's data.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FILE_NAME_PATTERN = '<domain>__<sourceSystemId>.csv';

/**
 * Minimal RFC4180-shaped delimited parser. A quoted field may contain the
 * delimiter, newlines, and doubled quotes. A quote appearing part-way through
 * an unquoted field is a literal character, which is what every spreadsheet
 * export does in practice.
 *
 * @returns {string[][]} rows of raw cells, trailing newline ignored
 */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The per-domain column manifest, computed from the mapping table rather than
 * maintained beside it.
 *
 * @returns {Map<string, {expected: Set<string>, required: Set<string>}>} keyed "domain|sourceSystemId"
 */
export function manifestFromMappings(mappings) {
  const manifest = new Map();
  for (const field of mappings.fields) {
    const key = `${field.domain}|${field.sourceSystemId}`;
    if (!manifest.has(key)) manifest.set(key, { expected: new Set(), required: new Set() });
    manifest.get(key).expected.add(field.sourceField);
    if (field.disposition === 'MAPPED') manifest.get(key).required.add(field.sourceField);
  }
  return manifest;
}

/**
 * @param {{fileName: string, bytes: Uint8Array|null, readError?: string}[]} files
 * @param {object} contract parsed export-intake-contract.json
 * @param {object} mappings parsed field-mapping document
 * @returns {{errors: string[], intake: object|null}}
 */
export function readExport(files, contract, mappings) {
  const errors = contractErrors(contract, mappings);
  if (errors.length > 0) return { errors, intake: null };

  const { delimiter, recordIdColumn } = contract.file;
  const manifest = manifestFromMappings(mappings);
  const exceptions = [];
  const records = [];
  const perFile = [];

  for (const file of [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    const { fileName } = file;
    const raise = (kind, detail, row = null, column = null) => {
      exceptions.push({ fileName, row, column, kind, detail });
      return null;
    };
    const accepted = readOneFile(file, { delimiter, recordIdColumn, manifest, raise });
    perFile.push({
      fileName,
      rowsRead: accepted === null ? 0 : accepted.rowsRead,
      recordsAccepted: accepted === null ? 0 : accepted.records.length,
      status: accepted === null ? 'REJECTED' : 'READ',
    });
    if (accepted !== null) records.push(...accepted.records);
  }

  exceptions.sort((a, b) => key(a).localeCompare(key(b)));
  records.sort((a, b) =>
    `${a.domain}|${a.sourceSystemId}|${a.recordId}`.localeCompare(
      `${b.domain}|${b.sourceSystemId}|${b.recordId}`
    )
  );

  return {
    errors: [],
    intake: {
      banner:
        'Export intake — file-shape reading only. No value was mapped or transformed. If the files read were SEEDED, so is every record below.',
      contractStatus: contract.status,
      mappingStatus: mappings.status,
      counts: {
        filesRead: files.length,
        filesRejected: perFile.filter((f) => f.status === 'REJECTED').length,
        recordsAccepted: records.length,
        exceptions: exceptions.length,
      },
      perFile,
      exceptions,
      source: {
        banner: `Read at intake from ${files.length} export file(s) by scripts/customer1-migration/read-export.mjs. Provenance is whatever those files were.`,
        records,
      },
    },
  };
}

function key(exception) {
  return [
    exception.fileName,
    String(exception.row ?? 0).padStart(9, '0'),
    exception.column ?? '',
    exception.kind,
  ].join('|');
}

function contractErrors(contract, mappings) {
  const errors = [];
  const file = contract?.file;
  if (file === null || typeof file !== 'object') return ['contract.file must be an object'];
  if (file.format !== 'CSV') errors.push(`contract.file.format "${file.format}" is not supported; only CSV`);
  if (file.encoding !== 'UTF-8') errors.push(`contract.file.encoding "${file.encoding}" is not supported; only UTF-8`);
  if (typeof file.delimiter !== 'string' || file.delimiter.length !== 1) {
    errors.push('contract.file.delimiter must be a single character');
  }
  if (typeof file.recordIdColumn !== 'string' || file.recordIdColumn.length === 0) {
    errors.push('contract.file.recordIdColumn must be a non-empty column name');
  }
  // The reader hardcodes how a file name is parsed. Asserting the contract says
  // the same thing keeps the document and the code from drifting apart quietly.
  if (file.fileNamePattern !== FILE_NAME_PATTERN) {
    errors.push(`contract.file.fileNamePattern must be "${FILE_NAME_PATTERN}"`);
  }
  if (!Array.isArray(mappings?.fields)) errors.push('mappings.fields must be an array');
  return errors;
}

function readOneFile(file, { delimiter, recordIdColumn, manifest, raise }) {
  const { fileName, bytes, readError } = file;

  if (typeof readError === 'string') return raise('UNREADABLE_FILE', readError);
  if (!fileName.endsWith('.csv')) {
    return raise('UNSUPPORTED_FORMAT', 'intake reads .csv only; export spreadsheets to CSV first');
  }
  if (!(bytes instanceof Uint8Array)) return raise('UNREADABLE_FILE', 'no bytes were provided for this file');
  if (bytes.length === 0) return raise('EMPTY_FILE', 'the file has no bytes');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return raise('ENCODING_NOT_UTF8', 'the file begins with a UTF-8 byte order mark; re-export without one');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return raise('ENCODING_NOT_UTF8', 'the bytes are not valid UTF-8');
  }

  const stem = fileName.slice(0, -'.csv'.length);
  const parts = stem.split('__');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return raise('UNPARSEABLE_FILE_NAME', `the file name does not match "${FILE_NAME_PATTERN}"`);
  }
  const [domain, sourceSystemId] = parts;
  const columns = manifest.get(`${domain}|${sourceSystemId}`);
  if (columns === undefined) {
    return raise(
      'UNDECLARED_SOURCE',
      `the mapping table names no fields for domain "${domain}" in system "${sourceSystemId}"`
    );
  }

  let rows;
  try {
    rows = parseDelimited(text, delimiter);
  } catch (error) {
    return raise('MALFORMED_DELIMITED', error.message);
  }
  if (rows.length === 0) return raise('EMPTY_FILE', 'the file has no header row');

  const header = rows[0].map((cell) => cell.trim());
  const duplicates = header.filter((name, index) => header.indexOf(name) !== index);
  if (duplicates.length > 0) {
    return raise('DUPLICATE_COLUMN', `column(s) appear more than once: ${[...new Set(duplicates)].sort().join(', ')}`);
  }
  const idIndex = header.indexOf(recordIdColumn);
  if (idIndex === -1) {
    return raise('MISSING_RECORD_ID_COLUMN', `the header has no "${recordIdColumn}" column`);
  }
  const unexpected = header.filter((name) => name !== recordIdColumn && !columns.expected.has(name));
  if (unexpected.length > 0) {
    return raise(
      'UNEXPECTED_COLUMN',
      `the mapping table dispositions no such column(s): ${[...unexpected].sort().join(', ')}`
    );
  }
  const missing = [...columns.required].filter((name) => !header.includes(name)).sort();
  if (missing.length > 0) {
    return raise('MISSING_COLUMN', `mapped column(s) absent from the export: ${missing.join(', ')}`);
  }

  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 1;
    if (row.length === 1 && row[0].trim() === '') continue; // a blank line is not a row
    if (row.length !== header.length) {
      raise('RAGGED_ROW', `expected ${header.length} cells, found ${row.length}`, line);
      continue;
    }
    const recordId = row[idIndex].trim();
    if (recordId === '') {
      raise('BLANK_RECORD_ID', `"${recordIdColumn}" is blank; the row has no identity`, line, recordIdColumn);
      continue;
    }
    const values = {};
    for (const [index, name] of header.entries()) {
      if (index !== idIndex) values[name] = row[index];
    }
    records.push({ domain, sourceSystemId, recordId, values });
  }
  return { rowsRead: rows.length - 1, records };
}

/** Read a directory into the {fileName, bytes} shape readExport takes. */
export function loadDirectory(dir) {
  return readdirSync(dir)
    .filter((name) => statSync(`${dir}/${name}`).isFile())
    .map((fileName) => {
      try {
        return { fileName, bytes: readFileSync(`${dir}/${fileName}`) };
      } catch (error) {
        return { fileName, bytes: null, readError: error.message };
      }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'docs/customer-1/data/seeded/export';
  const contractPath = process.argv[3] ?? 'docs/customer-1/data/export-intake-contract.json';
  const mappingsPath = process.argv[4] ?? 'docs/customer-1/data/seeded/SEEDED-field-mappings.json';
  let contract;
  let mappings;
  let files;
  try {
    contract = JSON.parse(readFileSync(contractPath, 'utf8'));
    mappings = JSON.parse(readFileSync(mappingsPath, 'utf8'));
    files = loadDirectory(dir);
  } catch (error) {
    console.error(`FAIL export intake: ${error.message}`);
    process.exit(1);
  }
  const { errors, intake } = readExport(files, contract, mappings);
  for (const error of errors) console.error(`FAIL export intake: ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(JSON.stringify(intake, null, 2));
}
