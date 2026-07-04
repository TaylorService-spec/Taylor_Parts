---
name: admin-check
description: Get a definitive, rules-bypassing, server-side answer about what's actually in Firestore or actually deployed for the taylor-parts project (Taylor_Parts repo) -- use whenever client-side reads/rules leave ambiguity about ground truth (e.g. "does this doc really exist," "is this really deployed," "what collections really exist").
---

# admin-check

Use this whenever a question needs a real, privileged, server-side answer instead of a client-side guess -- this project has been burned by trusting the Firestore console UI (silent non-saves) and by assuming committed rules/docs reflect what's actually live.

## Setup (once per machine, or if `node_modules` here is missing)

```bash
cd .claude/skills/admin-check
npm install
```

## Getting a service account key

If you don't already have one saved: Firebase console -> Project Settings (gear icon) -> Service Accounts tab -> "Generate new private key". **Save it outside this repo** (e.g. the user's Downloads folder) -- never commit it, and avoid pasting its contents into chat (if it ever is pasted, treat it as compromised and recommend rotating it once the immediate need is done).

Ask the user for the key's file path if you don't already have one from earlier in the session.

## Usage pattern

Write a small script (don't try to inline this as a one-liner -- Windows/git-bash path quirks make complex inline `node -e` unreliable, see `docs/CLAUDE_CONTEXT.md`) that requires this skill's `lib.js`:

```js
const initAdmin = require("<absolute-path-to>/.claude/skills/admin-check/lib.js");
const admin = initAdmin("<path-to-service-account-key.json>");

async function main() {
  // does a doc really exist?
  console.log(await admin.getDoc("users", "someUid"));

  // what's really in a collection?
  console.log(await admin.listCollection("fieldops_jobs"));

  // what collections actually exist, with doc counts -- the check that
  // caught fieldops_inventory/fieldops_job_events being documented as
  // real when nothing was ever written to them
  console.log(await admin.listAllCollections());

  // what's actually deployed, not just what's committed
  console.log(await admin.getDeployedRules());

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run it with plain `node your-script.js` from the repo root (or an absolute path), not from inside a `cd`-chained one-liner.

## When to reach for this vs. just reading the code/repo files

- Repo `firestore.rules` / `firestore.indexes.json` tell you what's *intended* -- only `admin.getDeployedRules()` / `firebase firestore:indexes` (CLI) tell you what's *live*.
- A Firestore console screenshot or "I created it" is not evidence a document was actually saved -- `admin.getDoc()` is.
- `docs/DataModel.md` documents what *should* exist -- `admin.listAllCollections()` is the check that once revealed a whole documented subsystem (inventory, job events, phase tracking) had never actually been built.

## Cleanup

This is a scratch/debugging tool, not application code -- don't wire it into the Vite app, don't add `firebase-admin` to `field-ops-app-vite/package.json`. Delete any one-off scripts you write against `lib.js` once the check is done; keep `lib.js` itself as the reusable part.
