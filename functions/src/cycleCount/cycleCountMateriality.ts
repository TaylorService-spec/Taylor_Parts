// Enterprise Inventory -- Cycle Count operating authority: MATERIALITY decision core for the
// separation-of-duties guard (Owner ruling, M23 blind-count remediation, 2026-08-18): "a counter
// cannot approve their own material variance." This module answers ONLY "is this variance material" --
// it has no opinion on WHO is disposing of it; cycleCountCommand.ts's reconcileCycleCount is what
// compares the disposing actor against the submitting actor and enforces the block.
//
// WHY A DUAL absolute-OR-relative RULE (not one fixed number): a fixed unit threshold alone is wrong at
// both ends of the part-population scale -- 3 units missing out of 3,000 is noise, but 3 units missing
// out of 4 is the whole count. A fixed percentage alone has the opposite failure: 1% of a population of
// 5 rounds to "never material," which would let small-population discrepancies dodge the guard
// entirely. This module treats a variance as material if EITHER bound trips: an absolute floor
// (protects small populations from a percentage that never clears) OR a relative ceiling (protects
// large populations from an absolute count that never clears). SERIAL mode reuses the identical rule
// over (missing + unexpected) discrete units against the expected serial count -- a missing or
// unexpected serial is exactly as discrete a unit as a NONE-mode quantity delta.
//
// CONFIGURABLE, NOT HARDCODED (task requirement -- do not bury a magic number): both bounds are read
// from environment variables at call time, not cached at cold start -- these are cheap parses, and an
// operator changing the config should see it take effect on the next invocation, not require a
// redeploy-triggered cache reset (contrast with resolveRuntimeCapabilityOverrides()'s cold-start cache,
// which is justified there because GCLOUD_PROJECT cannot change within a runtime; a materiality
// threshold can legitimately change without a deploy). An unset or unparsable value fails closed to the
// DOCUMENTED DEFAULT below, never to "never material" -- a broken config must not silently disable the
// separation-of-duties guard.
//
// DEFAULTS (Owner-reviewable, not empirically tuned -- there is no cycle count history yet to tune
// against): 3 absolute units, 10% of the expected quantity/population. Chosen as a conservative
// starting point that catches the two shapes of integrity risk this guard exists for -- a double-digit
// percentage miss at any population size, or a handful of missing/unexpected units even at a large
// population where the percentage alone would round away -- without forcing manager review of every
// rounding-level, single-unit discrepancy on a large count. Override via
// CYCLE_COUNT_MATERIALITY_ABS_UNITS (non-negative integer) and CYCLE_COUNT_MATERIALITY_PCT (a fraction
// in [0, 1], e.g. "0.1" for 10%).
const DEFAULT_ABSOLUTE_UNITS = 3;
const DEFAULT_RELATIVE_FRACTION = 0.1;

function readNonNegativeInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return n;
}

function readUnitFraction(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

export interface CycleCountMaterialityConfig {
  readonly absoluteUnits: number;
  readonly relativeFraction: number;
}

// Reads the current environment's configured thresholds, fail-closed to the documented defaults on
// anything missing or unparsable. Deliberately uncached -- see header note.
export function resolveCycleCountMaterialityConfig(): CycleCountMaterialityConfig {
  return {
    absoluteUnits: readNonNegativeInt("CYCLE_COUNT_MATERIALITY_ABS_UNITS", DEFAULT_ABSOLUTE_UNITS),
    relativeFraction: readUnitFraction("CYCLE_COUNT_MATERIALITY_PCT", DEFAULT_RELATIVE_FRACTION),
  };
}

// PURE decision core: is a discrepancy of `discrepancyUnits` (already a non-negative magnitude, e.g.
// Math.abs(variance) for NONE mode or missing.length + unexpected.length for SERIAL mode) against an
// expected population of `expectedUnits` material under `config`? Zero discrepancy is never material
// regardless of config. A discrepancy against a zero-sized expected population has no percentage to
// compute -- treated as material unconditionally (there is no such thing as an immaterial fraction of
// nothing already having a variance).
export function isMaterialCycleCountVariance(discrepancyUnits: number, expectedUnits: number, config: CycleCountMaterialityConfig): boolean {
  if (discrepancyUnits <= 0) return false;
  if (discrepancyUnits >= config.absoluteUnits) return true;
  if (expectedUnits <= 0) return true;
  return discrepancyUnits / expectedUnits >= config.relativeFraction;
}
