# Review resolution artifacts — evidence-hash derivation

Each `*.resolution.json` records a governed review resolution. Findings carry `evidenceRefs` of the form
`<name>@<sha256>`, pinning the exact reviewed source so it cannot change silently. `*.resolution.test.mjs`
verifies every reference against the current tree.

## Authoritative derivation

The `<sha256>` is the SHA-256 of the referenced file's **content with line endings normalized to LF**
(every `\r\n` → `\n`, then hash). Content — not raw on-disk bytes — is what the evidence pins.

Why normalized: a Windows checkout smudges LF→CRLF on the working tree, so hashing raw bytes would make an
identical-content file hash differently on Windows (CRLF) vs Linux/CI (LF) — green on CI, red on a Windows dev
machine, for no real change. Normalizing to LF makes the assertion deterministic on every platform.

File resolution order for a bare `<name>` (first existing wins): `docs/orchestration/lib/<name>`, then
`integrations/chatgpt-eos-intake/test/<name>`, then the finding's own `codeRefs`.

## Regenerating after an intentional source change

When a reviewed file changes on purpose, re-derive its hash with the **same LF normalization** and update the
matching `evidenceRefs` entry in the resolution JSON (do not weaken or delete the assertion). One-liner:

```bash
node -e 'const{createHash}=require("crypto"),{readFileSync}=require("fs");const p=process.argv[1];const lf=Buffer.from(readFileSync(p).toString("latin1").replace(/\r\n/g,"\n"),"latin1");console.log(createHash("sha256").update(lf).digest("hex"))' <path-to-file>
```

The resolution test also asserts a fixed count of verified references, so a refactor that stops resolving a
ref fails loudly instead of passing vacuously.
