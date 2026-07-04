---
name: doc-reality-check
description: Cross-check a docs/*.md file's claims (collections, fields, service files, enums) against what's actually in the code and actually deployed. Use before trusting any doc's schema/architecture claims as fact, especially docs written by a different/prior session, and use periodically on docs/Architecture.md, docs/FirebaseIntegration.md, docs/SprintRoadmap.md, docs/Deployment.md -- all four are known to have unverified drift as of this writing (see docs/CLAUDE_CONTEXT.md).
---

# doc-reality-check

This project has already had one confirmed case of a doc describing a fully-built system (a real inventory collection, a persisted job-event log, a `JOB_PHASE` field/transition system) as fact when none of it existed anywhere in the code or the live database. This skill is the repeatable version of the process that caught it.

## Steps

1. **Extract every concrete claim** from the doc under review: collection names, field names, file paths (especially anything under a `services/` directory, since that directory doesn't exist in this repo), enum values, function names.

2. **Grep the actual code for each one:**
   ```bash
   grep -rn "<name>" field-ops-app-vite/src/
   ```
   Zero matches = the claim describes something that was never built, no matter how confidently or specifically it's written (the fabricated inventory system included exact field names, a doc-ID scheme, and transactional logic descriptions -- specificity is not evidence).

3. **Cross-check collections against live ground truth** using `.claude/skills/admin-check`:
   ```js
   const initAdmin = require("../admin-check/lib.js");
   const admin = initAdmin("<key-path>");
   console.log(await admin.listAllCollections());
   ```
   A collection can exist in the live database with the right name but still not match the doc's claimed *fields* -- check `admin.listCollection(name)` on a couple of real docs too, not just collection existence.

4. **Classify every claim** with a reality marker, matching the convention already established in `docs/DataModel.md`:
   - ✅ **IMPLEMENTED** -- confirmed live data + confirmed write path in code.
   - 🧪 **SCAFFOLDED, UNUSED** -- the code to write it exists (e.g. a `makeCollectionStore()` call), but nothing calls it; no live data.
   - ❌ **NOT BUILT** -- described as if real, but zero grep matches and/or zero live data.

5. **Don't silently "fix" the doc by deleting the false content** -- follow the pattern used in `docs/DataModel.md`: keep the claim, mark it ❌, and note what (if anything) it should be replaced with as a reference for future work. Deleting it loses the historical signal that someone once thought this was worth building.

6. **If auditing multiple docs from the same session/timestamp cluster** (check file mtimes or `git log --diff-filter=A -- <file>` to identify which session wrote what), audit all of them together -- a fabrication pattern in one doc from a given session is likely to repeat in its siblings (confirmed: the same fabricated inventory/job-events/phase system was independently described across four different docs written in the same session).

## Known outstanding candidates (as of this writing)

`docs/Architecture.md`, `docs/FirebaseIntegration.md`, `docs/SprintRoadmap.md`, and `docs/Deployment.md` all repeat the same fabricated inventory/job-events/phase claims that were corrected in `docs/DataModel.md`. They have not yet been run through this process -- a good first real use of this skill.
