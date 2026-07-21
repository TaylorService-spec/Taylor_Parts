# Execution Environments

**Status:** Normative. Adopted for the Taylor_Parts / Enterprise Operations OS program.
**Related:** [audit-artifact-standard.md](audit-artifact-standard.md) · [templates/operational-handoff.md](templates/operational-handoff.md) · `../DelegationCharter.md` · `../architecture/SYSTEM_AUTHORITIES.md`

## Purpose

This standard prevents:

- commands being executed in the wrong environment;
- false claims of environment access (e.g. an agent claiming it ran a command in an environment it cannot reach);
- misplaced or lost evidence artifacts;
- accidental production access;
- confusion between the Windows workstation, Git Bash, WSL, Google Cloud Shell, CI, and repository worktrees.

Every operational action in this program happens in exactly one identified environment. An actor must verify — not assume — which environment it is in before acting, and must never represent work done in one environment as if it happened in another.

## Authoritative Environments

### Windows Development Workstation

The environment the repository-side AI agent (Windows Claude Code) runs in.

**Responsibilities**
- repository editing;
- local tests;
- branch and worktree management;
- documentation;
- commits and pull requests;
- non-production Firebase emulator testing when configured.

**Current path examples**
- Windows path: `D:\Taylor_Parts`
- Git Bash path: `/d/Taylor_Parts`
- Windows home: `C:\Users\Rudy2`
- Git Bash home: `/c/Users/Rudy2`

**Restrictions**
- no assumed Google Cloud Shell access;
- no assumed production credentials (no gcloud, no ADC by default);
- no production operation unless credentials and authorization are explicitly verified in this environment (they are not, by default).

### Google Cloud Shell

The operator's authenticated environment for production operations.

**Responsibilities**
- explicitly authorized production reads;
- production audit execution;
- controlled Firebase or Google Cloud operations;
- production evidence generation when ADC or gcloud credentials are required.

**Restrictions**
- production writes and deploys require a separately approved gate (merge authorization is never deploy authorization);
- Cloud Shell artifacts are **not** automatically available to the Windows workstation — they must be explicitly transferred and re-verified;
- `/home/...` paths belong to Cloud Shell, not Windows or Git Bash.

### CI / GitHub Actions

**Responsibilities**
- repeatable automated validation;
- contract tests;
- lint / build / test checks;
- merge protection.

**Restrictions**
- CI success does not itself authorize production deployment;
- secrets must remain in approved secret stores;
- logs must not expose sensitive values.

### GitHub Repository

The authoritative source of truth for:

- architecture;
- governance;
- specifications;
- implementation plans;
- code;
- tests;
- preserved evidence;
- deployment history where documented.

When environments or reports disagree, the merged repository state on `main` wins.

## Responsibility Matrix

| Activity | Windows Claude Code | Cloud Shell Operator | CI | Requires Explicit Authorization |
|---|---|---|---|---|
| Documentation changes | Yes | — | validates | No (Tier 1) |
| Code changes | Yes | — | validates | No (Tier 1) unless it touches a Tier 2 surface |
| Local / emulator tests | Yes | — | Yes | No |
| Production **read** audit | No | Yes | — | Yes (Owner read authorization) |
| Production **write** | No | Yes | — | Yes (separate write gate) |
| Firestore Rules deployment | No | Yes | — | Yes (Tier 2 + separate deploy auth) |
| Functions deployment | No | Yes | — | Yes (Issue #15 + separate deploy auth) |
| Index deployment | No | Yes | — | Yes (separate deploy auth) |
| Evidence preservation (into repo) | Yes | generates artifact | — | No (repo work); artifact generation requires the read auth above |
| PR creation | Yes | — | — | No |
| PR merge | Yes | — | gates | Yes (Owner merge authorization) |

## Mandatory Environment Declaration

Every operational handoff must identify:

- execution host;
- operating shell;
- repository path;
- branch / worktree;
- credentials expected;
- production access expected;
- artifact source path;
- artifact destination path;
- actor responsible for execution.

See the reusable header below and [templates/operational-handoff.md](templates/operational-handoff.md).

## Path Translation Rules

- `C:\Users\Rudy2\...` is a **Windows** path.
- `/c/Users/Rudy2/...` is the **Git Bash (MINGW64)** representation of that same Windows path.
- `/home/<user>/...` (e.g. `/home/rudy_digiorgio/...`) may belong to **Google Cloud Shell** and is **not** inherently available to Windows or Git Bash.
- `/mnt/c/...` is normally a **WSL** path and must not be assumed to exist in Git Bash, Cloud Shell, or generic Linux.
- A file's existence must be **verified in the environment that is expected to consume it** — a path printed by one environment is not proof the file exists in another.

## Production Operation Rules

Every production operation requires:

- an explicit project identifier (e.g. `taylor-parts`);
- an explicit production confirmation (e.g. the audit tooling's `--confirmProduction taylor-parts`);
- a read-only / write classification stated up front;
- rollback or recovery considerations for any write (captured pre-change state, e.g. the pre-deploy Rules SHA);
- preservation of output for governed evidence (terminal output alone is not evidence);
- **no implied authorization from prior audit success** — a GO audit authorizes nothing beyond recording compatibility.

## Prohibited Assumptions

- Never infer the runtime from path syntax alone.
- Never claim access to an environment not directly verified.
- Never relabel a NO-GO artifact as GO.
- Never edit generated audit evidence to change its outcome.
- Never treat terminal output as preserved evidence unless it is saved to a durable artifact.
- Never use one environment's path as though it exists in another.

## Standard Environment Header

```text
Execution Environment
Host:
Shell:
Repository:
Worktree:
Branch:
Credentials:
Production Access:
Artifact Source:
Artifact Destination:
Executor:
Authorization:
```

## Failure Handling

- **An artifact cannot be found:** stop; report the exact path checked and the environment it was checked in; request the artifact be placed or its contents provided. Do not fabricate it.
- **Environments disagree:** treat merged `main` as authoritative; surface the discrepancy explicitly; do not silently pick one.
- **Credentials are unavailable:** report BLOCKED BY ACCESS; do not search for, source, or enter alternative credentials; do not attempt browser login.
- **Evidence does not match the stated decision:** stop; report the exact field-level discrepancy; never edit the artifact to match the claim.
- **The current checkout is dirty:** do not modify, clean, reset, stash, or switch it; do the work in a dedicated clean worktree off `origin/main`.
- **A production operation cannot be independently verified:** record it as reported-by-operator (attributed), not as independently verified; leave the relevant status Pending until verification exists.
