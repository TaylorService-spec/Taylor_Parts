# Sandbox refresh - the Windows operator command

**Canonical instruction:**

```powershell
cd D:\Taylor_Parts-eos
.\sandbox-refresh.ps1
```

That is the whole command. No Git Bash path, no `/d/` translation, no `cd` inside a shell string, no
quoting, no `firebase` invocation.

If PowerShell's execution policy blocks it, one documented fallback - which does **not** change the
machine-wide policy and does **not** require Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\sandbox-refresh.ps1
```

## What runs underneath

`sandbox-refresh.ps1` is an **operator adapter**, not a deployment. It contains no `firebase`
invocation, no deploy ordering, no environment resolution and no guard logic.

```
.\sandbox-refresh.ps1                    the operator entry point (banners, exit code, missing-file errors)
  -> scripts/Invoke-SandboxRefresh.ps1   locates Git Bash, hands off
    -> scripts/_sandboxRefresh.run.sh    THE GOVERNED IMPLEMENTATION - unchanged
```

Every control still runs, inside the governed script:

| Control | What it proves |
| --- | --- |
| `_sandboxDeployGuard.mjs` | role != production, projectId == `eos-platform-sandbox` |
| `_releaseProvenanceGuard.mjs` | HEAD is contained in `origin/main` and is its tip; the tree is clean |
| toolchain preflight | `node` / `npm` / `firebase` present, named if missing |

There is exactly one deployment implementation. The deploy ordering in the bash script -
build-base before the environment build, artifact verification before Hosting - is load-bearing and
was the direct cause of the 2026-08-19 incident. A PowerShell reimplementation would be a second
copy of that ordering, free to drift. The wrapper deliberately has none of it.

## Why the wrapper exists

Three separate failures, none of them about the deployment:

1. **`bash` resolves to the WSL shim** on this machine, not Git Bash. WSL is a different machine
   with a different PATH - the Windows node/npm/firebase install is simply not in it - so the script
   gets several steps into a deploy and dies on `node: command not found`, blaming the wrong thing.
   `where.exe bash` lists both candidates.
2. **Git Bash did not inherit the caller's working directory.** The governed script anchors itself
   with `dirname "$0"/..`, which is *relative*, so when the cwd was wrong it resolved the repository
   root to `D:\Git` - and `cd` succeeded silently. The visible error was
   `Cannot find module 'D:\Git\scripts\_sandboxDeployGuard.mjs'`.
3. **The quoting needed to survive both** is its own puzzle.

A wrong root that resolves cleanly is the dangerous one: nothing fails, and the run proceeds from
the wrong tree.

## Reading the result

The wrapper prints a banner and propagates the real exit code - a non-zero child exit fails the
PowerShell command, and the success banner never prints after a failure.

**A clean exit is not evidence the artifact is live.** The governed script prints the deployed
`version.json`; compare its `commit` against the commit you expected. That, not the exit code, is
the evidence.

If it fails partway, some functions may already have deployed. Every step is idempotent, so
re-running is safe - but read which step failed first.

## Governance

The wrapper is a **protected action**, exactly like the script it launches. It is an operator
convenience, not a new authority: an agent session may not run it, and adding it must not become a
way around the protected-action policy. See `.claude/permission-policy.md`.
