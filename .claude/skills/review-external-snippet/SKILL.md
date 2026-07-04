---
name: review-external-snippet
description: Checklist for evaluating pasted/external code (from another AI, another chat, a tutorial, etc.) before applying it to this repo. Use whenever a user pastes a code block and asks to "process," "implement," or "apply" it, especially for AuthContext/auth flow, Firestore schema, or dispatch/Control Tower code -- this project has repeatedly received plausible-looking snippets that conflict with its actual architecture.
---

# review-external-snippet

This session received many pasted snippets (AuthContext rewrites, a `workOrders`-collection redesign, Firestore rules variants) that looked reasonable in isolation but conflicted with this repo's real conventions. Some were adapted, most were declined outright. This is the checklist that made those calls quickly instead of re-deriving project context from scratch each time.

## Before applying anything pasted, check it against:

1. **Does it match this project's actual enums/collection names?**
   `JOB_STATUS` is `open/assigned/in_progress/complete` (lowercase, underscored) -- a snippet using `new/assigned/in-progress/completed` or similar is describing a different schema, not a compatible extension. Same check for `TECH_STATUS`, `ROLES`, collection names (`fieldops_jobs`/`fieldops_technicians`/`users`, not `jobs`/`technicians`/`workOrders`).

2. **Does it write to Firestore from a UI component, or introduce a second write path?**
   Only `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()`/`createJob()`/`createTechnician()` may write job/technician state. A snippet with an inline `updateDoc()` call inside a component is an automatic decline or requires routing through the real write path first.

3. **Does it introduce a new persisted collection for something already computed live?**
   This project's default is: derive aggregates on read (dispatch recommendations, Work Order state, the priority queue, the activity timeline), never cache them in a second collection. A pasted `dispatchQueue`/similar persisted-ranking collection is exactly the anti-pattern this repo has repeatedly avoided -- push back and ask whether it's really needed, or whether a `rankXByY()`-style pure function fits better (see `domain/dispatchEngine.js`/`domain/dispatchScoring.js` as the established pattern).

4. **Does it reintroduce a redundant state/flag?**
   Watch for a new `ready`/`hydrated`/`isLoaded` boolean proposed alongside an existing `loading`/`status` that already means the same thing (this happened at least three times with `AuthContext` rewrites this session). Two flags meaning the same fact is worse than one, since they have to be kept in sync forever.

5. **Does it silently grant elevated access?**
   Any fallback like `role ?? "admin"`, a URL-param-driven privilege escalation, or a rule that widens `allow write` beyond admin-provisioned-only should be treated as a hard stop, not a style preference -- flag it explicitly rather than folding it in quietly. (A demo-mode admin-fallback that nobody could explain the origin of was found and removed from this exact codebase.)

6. **Does it assume infrastructure that doesn't exist?**
   `react-router` is not installed (`App.jsx` is a hand-rolled `NAV`/`activeTab` tab list, no client routes) -- a pasted `<Route>`/`element=` snippet requires adding a router first, which is a much bigger change than "apply this snippet." Same check for anything assuming a `services/` directory, Cloud Functions, or Admin SDK usage -- none of that infrastructure exists in this repo today.

## How to respond when a snippet fails one of these

Don't apply it silently and don't reject it silently either -- name the specific conflict (which rule, which existing file/pattern it contradicts) and ask whether the user wants it adapted to fit the real architecture, or whether it was pasted for comparison/reference rather than to actually implement. Several turns this session were exactly this pattern: identify the conflict, explain it concretely, then let the user decide rather than guessing their intent.
