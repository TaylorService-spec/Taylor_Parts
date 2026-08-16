// Detects an audit result that LOOKS clean but was never extracted.
//
// `childFromResult` (findingSchema.mjs) fail-closes a missing `eos-findings` block to
// EXTRACTION_INVALID -- but only for runs made AFTER that contract landed (#863,
// 2026-08-13 10:05). Results landed BEFORE it sit on disk recorded as `COMPLETE` with
// `findings: []`, which is indistinguishable from a genuine clean audit. EOS-ISSUE-852
// is the proven case: ten children reported zero, eight had written real defects in
// prose, and one of those (a HIGH) stayed open for three days because nobody read it.
//
// This module reads the human report back and asks: does this content look like it
// found something? A "clean" result whose prose is full of severity-ranked findings is
// UNEXTRACTED, not clean. Pure and side-effect free; the caller decides what to do.

const FINDINGS_BLOCK = /```eos-findings\b/;

// Prose shapes an audit worker actually used before the structured contract existed.
const SIGNALS = [
  { id: "severity-labelled-item", re: /\*\*\s*(?:\d+\.\s*)?(?:CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/gi },
  { id: "findings-heading", re: /^#{2,4}\s*Findings\b/gim },
  { id: "numbered-finding", re: /^\*\*\d+\.\s+(?:CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/gim },
];

// Phrases that mean the worker genuinely found nothing. Counted, then subtracted --
// "No security-relevant findings" must not read as evidence OF findings.
const CLEAN_PHRASE = /\bno\s+(?:security-relevant\s+|material\s+|new\s+)?findings?\b/gi;

const count = (text, re) => (text.match(re) || []).length;

/**
 * @param {object}  args
 * @param {object}  args.result   parsed *.result.json (needs status/disposition + findings)
 * @param {string}  args.content  the sibling *.content.md human report
 * @returns {{unextracted:boolean, reason:string, signals:string[], signalCount:number, cleanPhrases:number}}
 */
export function detectUnextracted({ result = {}, content = "" } = {}) {
  const status = result.status ?? result.disposition ?? null;
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const base = { signals: [], signalCount: 0, cleanPhrases: count(content, CLEAN_PHRASE) };

  // Only a COMPLETE-and-empty result can be a false clean. Anything else is already
  // visible as a problem, or genuinely carries findings.
  if (status !== "COMPLETE") return { ...base, unextracted: false, reason: "not a COMPLETE result" };
  if (findings.length > 0) return { ...base, unextracted: false, reason: "result already carries findings" };

  // Post-#863 runs carry the block; its presence means extraction ran and [] is truthful.
  if (FINDINGS_BLOCK.test(content)) {
    return { ...base, unextracted: false, reason: "eos-findings block present — empty result is trustworthy" };
  }
  if (!content.trim()) {
    return { ...base, unextracted: false, reason: "no content to re-read" };
  }

  const hits = [];
  let n = 0;
  for (const s of SIGNALS) {
    const c = count(content, s.re);
    if (c > 0) { hits.push(s.id); n += c; }
  }
  // A worker that says "no findings" once and shows one severity word is describing
  // its own clean verdict, not reporting a defect. Require net evidence.
  const net = n - base.cleanPhrases;
  const unextracted = net > 0;
  return {
    ...base,
    signals: hits,
    signalCount: n,
    unextracted,
    reason: unextracted
      ? `no eos-findings block, but the report carries ${n} finding-shaped signal(s) against ${base.cleanPhrases} clean phrase(s) — treat as UNEXTRACTED, re-read the content`
      : "no eos-findings block, and the report shows no net finding-shaped content — plausibly a genuine clean run",
  };
}
