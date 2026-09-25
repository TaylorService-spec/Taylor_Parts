// THE SHARED EXECUTABLE-REFERENCE FENCE.
//
// ONE implementation of the question "does this file actually REACH that module, or does it merely
// TALK about it?", so a boundary probe cannot be tripped by the prose that explains the boundary.
//
// ════════════════════ WHY THIS EXISTS (Lane BS) ════════════════════
//
// This repository has now shipped the same defect FOUR times: a boundary guard written as a bare
// substring scan over raw source, which then fires on a COMMENT naming the very coupling the comment
// exists to say is forbidden. Lane AO fixed it once for Firestore collections by anchoring to a
// Firestore-shaped RECEIVER and extracted ./firestoreCollectionFence.mjs; Lane AT reused that across
// its siblings. The fifth occurrence was three at once: commercialTransport (21),
// commercialReadProjections (2) and crmAuthority (F2) all tripped on comments that Lane BQ added to
// src/eosOps/experienceAuthority.ts and to the new client files, none of which import anything.
//
// This module is NOT a fifth comment stripper. It imports Lane AO's `stripComments` unchanged and
// adds the one thing the AO helper does not cover: module-graph reference shape. Everything below is
// ANCHORED, in exactly the sense adminPolicyNoFirebase.test.mjs argues for:
//
//   a module name is only evidence of COUPLING when it sits in a MODULE-SPECIFIER position --
//   `from "x"`, `import("x")`, `require("x")`, `import "x"`. A bare substring is too broad: it
//   cannot tell an import from an English sentence, and the only way to appease it is to delete the
//   sentence, which is how a boundary loses the note saying why it exists.
//
// Anchoring is also STRICTLY STRONGER than the raw scan it replaces. The raw scan sees only the text
// it was given; this sees a dynamic `import()`, a `require()`, a bare side-effect `import "x"`, and
// a specifier written with single quotes or backticks -- all of which a raw list of two spellings
// missed.
//
// Comment stripping is kept as DEFENCE IN DEPTH, not as the anchor. A guard that relied on stripping
// alone would be defeated by a trailing `// ... from "eosCrm/x"` on a line of real code; a guard that
// relied on the anchor alone would be defeated by nothing here, which is the point.
import { stripComments } from "./firestoreCollectionFence.mjs";

export { stripComments };

/**
 * Every MODULE SPECIFIER a file actually imports, in all four executable spellings.
 *
 *   static     import x from "spec" / import { a } from "spec" / export { a } from "spec"
 *   bare       import "spec"
 *   dynamic    import("spec")
 *   commonjs   require("spec")
 *
 * Prose is excluded twice over: comments are stripped first, and what survives must still sit in a
 * specifier position. "see eosCrm/contactAuthority.ts" is not a specifier and never becomes one.
 */
export function moduleSpecifiers(source) {
  const code = stripComments(source);
  const found = [];
  const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]([^'"`\n]+)['"`]/g;
  for (const [, spec] of code.matchAll(SPECIFIER)) found.push(spec);
  return found;
}

/**
 * A specifier as a path relative to `rootDir`, so a relative import and an absolute-ish one are
 * comparable. A package specifier ("pg", "react") is returned unchanged -- it names no file in the
 * tree and no boundary in it is about one.
 */
export function resolveSpecifier(fromFile, spec, rootDir, path) {
  if (!spec.startsWith(".")) return spec;
  return path.relative(rootDir, path.resolve(path.dirname(fromFile), spec)).split("\\").join("/");
}

/**
 * Does this file IMPORT something matching `pattern`? `pattern` is tested against each resolved
 * specifier, never against the file's prose.
 */
export function importsModule(source, pattern, { fromFile, rootDir, path } = {}) {
  return moduleSpecifiers(source).some((spec) =>
    pattern.test(fromFile && rootDir && path ? resolveSpecifier(fromFile, spec, rootDir, path) : spec),
  );
}

/**
 * Does `pattern` appear in EXECUTABLE code -- an identifier, a call, a value -- rather than in a
 * comment? The caller supplies the anchor; this only guarantees the text was not prose.
 */
export function namesInCode(source, pattern) {
  return pattern.test(stripComments(source));
}

/**
 * Does the code hold `needle` inside a QUOTED STRING LITERAL?
 *
 * The anchor for a ROUTE or an OPERATION NAME, which is the transport equivalent of AO's
 * Firestore-shaped receiver. "POST /commercial/sales returns the index" is documentation; only
 * `"/commercial/sales"` is a thing a fetch can be pointed at. A trailing comment cannot fake it
 * without writing the quotes, which is then a deliberate act and not an accident of prose.
 */
export function namesStringLiteral(source, needle) {
  return new RegExp(`['"\`][^'"\`\\n]*${needle}`).test(stripComments(source));
}
