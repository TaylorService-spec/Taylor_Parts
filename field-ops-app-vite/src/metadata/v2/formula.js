// Formula fields — a constrained, validated expression vocabulary.
//
// §8 OF THE BOUNDARY IS THE DESIGN CONSTRAINT: metadata is never executable. A formula is
// therefore an AST of plain data, made of a closed operator set, referencing fields by
// systemName. It can be parsed, type-checked and dependency-analyzed before it ever runs.
//
// What this forbids is not a style preference. If a definition could carry a function,
// every definition would be a code path, "what can this configuration do?" would stop
// having an answerable form, and a tenant-supplied field would become remote code
// execution wearing a metadata shape.
//
// So: no eval, no dynamic import, no function invocation, no arbitrary property
// traversal. A node is one of exactly three things — an operator, a field reference, or a
// literal — and anything else is rejected at validation, not at evaluation.

export const FORMULA_OPERATOR = Object.freeze([
  "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE",
  "MIN", "MAX", "ROUND",
  "IF", "AND", "OR", "NOT",
  "COALESCE",
  "CONCAT", "TRIM", "LOWER", "UPPER",
  "DATE_DIFF",
]);

/** Operators grouped by the type they produce, so a result type is statically knowable. */
const NUMERIC_OPS = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX", "ROUND", "DATE_DIFF"];
const BOOLEAN_OPS = ["AND", "OR", "NOT"];
const STRING_OPS = ["CONCAT", "TRIM", "LOWER", "UPPER"];

export const field = (systemName) => Object.freeze({ field: systemName });
export const literal = (value) => Object.freeze({ literal: value });
export const op = (operator, ...args) => Object.freeze({ op: operator, args: Object.freeze(args) });

const isFieldRef = (n) => n && typeof n === "object" && typeof n.field === "string";
const isLiteral = (n) => n && typeof n === "object" && "literal" in n;
const isOp = (n) => n && typeof n === "object" && typeof n.op === "string";

/**
 * Validate a formula AST.
 *
 * Every rejection names what was wrong AND where, because a formula that fails validation
 * with "invalid expression" is a formula nobody can fix.
 */
export function validateFormula(node, { at = "formula", path = "" } = {}) {
  const problems = [];
  const where = path ? `${at}${path}` : at;

  if (node === null || node === undefined) {
    problems.push(`${where}: an expression node is required`);
    return problems;
  }
  if (typeof node === "function") {
    // The §8 tripwire, stated as its own message: this is not a type error, it is the
    // executable-metadata prohibition.
    problems.push(`${where}: a formula may never contain a function — metadata is not executable`);
    return problems;
  }
  if (typeof node !== "object" || Array.isArray(node)) {
    problems.push(`${where}: an expression node must be an operator, a field reference, or a literal`);
    return problems;
  }

  if (isLiteral(node)) {
    if (typeof node.literal === "function") {
      problems.push(`${where}: a literal may never be a function`);
    }
    return problems;
  }
  if (isFieldRef(node)) {
    // A field reference is a systemName, not a path. Allowing "account.owner.email" here
    // would be arbitrary property traversal in disguise, and would silently cross an
    // entity boundary that LOOKUP exists to make explicit and authority-checked.
    if (node.field.includes(".")) {
      problems.push(`${where}: "${node.field}" traverses a path — use a LOOKUP field for a related value`);
    }
    return problems;
  }
  if (!isOp(node)) {
    problems.push(`${where}: an expression node must be an operator, a field reference, or a literal`);
    return problems;
  }
  if (!FORMULA_OPERATOR.includes(node.op)) {
    problems.push(`${where}: operator "${node.op}" is not in the approved vocabulary`);
    return problems;
  }
  const args = node.args ?? [];
  if (!Array.isArray(args) || args.length === 0) {
    problems.push(`${where}: operator "${node.op}" requires arguments`);
    return problems;
  }
  if (node.op === "IF" && args.length !== 3) {
    problems.push(`${where}: IF requires exactly a condition, a then, and an else`);
  }
  if (node.op === "NOT" && args.length !== 1) {
    problems.push(`${where}: NOT takes exactly one argument`);
  }
  args.forEach((arg, i) => problems.push(...validateFormula(arg, { at, path: `${path}.${node.op}[${i}]` })));
  return problems;
}

/** Every field systemName a formula depends on, deduplicated, in first-seen order. */
export function formulaDependencies(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (isFieldRef(node)) {
    if (!found.includes(node.field)) found.push(node.field);
    return found;
  }
  for (const arg of node.args ?? []) formulaDependencies(arg, found);
  return found;
}

/**
 * The type a formula produces, where it is statically knowable.
 *
 * Returns null rather than guessing when it is not — COALESCE and IF produce whatever
 * their branches produce, and asserting a type for them would make the declaration a
 * confident lie rather than an honest gap.
 */
export function formulaResultType(node) {
  if (!isOp(node)) return null;
  if (NUMERIC_OPS.includes(node.op)) return "DECIMAL";
  if (BOOLEAN_OPS.includes(node.op)) return "BOOLEAN";
  if (STRING_OPS.includes(node.op)) return "STRING";
  return null;
}
