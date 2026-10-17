# PRESERVE ONLY — DO NOT MERGE / DO NOT RUN

Lane Firebase (Firebase exit F1–F7b) working tooling, preserved before the session is archived.
Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

- `scratchpad/` is the lane's session scratchpad, copied verbatim. It holds one-shot edit scripts (`*.py`), the WSL
  test/regeneration harness (`*.sh`: private Postgres on :55507, bounded single-process runs), PR bodies (`pr-*.md`),
  review messages (`msg-*.txt`), and working notes (`f1-map.md`, `callables-27.md`, `bin-divergence.md`, `pool-census.md`).
- Left out: runtime logs and test outputs (`*.log`, `*.out`, which are regenerable or CI downloads) and `ose_head.mjs`
  (a copy of a repository file at a commit, not lane work).
- Credential scan: there are no keys, tokens, service-account JSON or `.env` files. The only URL-with-userinfo
  matches are `postgres://fence:fence@127.0.0.1:1/never`, the deliberately invalid fence URL already in three test
  files on main, and the local Cursor dev URL quoted from `AGENTS.md`. Neither is a credential.
- Historical Firebase copy tools, the manufacturer copy included, are Owner-held. **Preservation does not authorize
  execution.**
