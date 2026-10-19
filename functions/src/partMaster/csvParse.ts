// CSV parsing (RFC-4180-style: quoted fields, embedded commas/quotes/newlines).
//
// PURE and import-free, on purpose. It lived inside csvMigrationAnalysis.ts, whose other imports reach firebase-admin/firestore (the alias
// repository); the shared Data Import intake (dataImport/importIntake.ts) needs ONLY this function, and an EOS operation (Firebase exit B4,
// eosOps/dataImportOperations.ts) must be able to use that intake without loading the Firebase Admin SDK. csvMigrationAnalysis.ts re-exports
// this function, so every existing importer is unchanged.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
  return rows;
}
