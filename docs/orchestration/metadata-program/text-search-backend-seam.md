# Text-query operator vocabulary and the backend seam

> Workstream: `A-TEXT-QUERY-SEMANTICS` (LEDGER.md `X-QUERY-MODEL-NO-FREE-TEXT`, phase 6)
> Base: `origin/main` @ `7248b4d93eb8cca580ffbf15cc56fa4fc2fa7160`
> Scope: extends `field-ops-app-vite/src/metadata/listViewDefinition.js`'s query
> vocabulary and validator only. No new provider, no runtime, no route change.

## Why this document exists

`X-QUERY-MODEL-NO-FREE-TEXT` (recorded in LEDGER.md) found that the query model has no
free-text operator, so no substring-search surface — Parts being the concrete case —
can migrate onto the list-metadata runtime. That gap is real, but closing it by adding a
`TEXT_CONTAINS`-shaped operator and quietly wiring it to whatever Firestore can do today
would recreate the exact defect class this program keeps finding: **metadata declaring
something nothing consumes**, or worse here, metadata declaring something a *different*
thing consumes without telling anyone. Prefix and substring are different products. A
user who types "anch" into a search box expecting every part whose description mentions
"wrench" is being lied to if the backend silently only matches names that *start with*
"anch".

This document is the seam: the vocabulary, what each operator means, which ones
`FIRESTORE_NATIVE` — the only backend that exists — can serve honestly, how a filter
opts a specific field into a specific backend, what happens when it can't, and what a
future real search backend would need to satisfy to be added. It intentionally builds
no provider and picks no vendor.

## The vocabulary

Declared in `field-ops-app-vite/src/metadata/listViewDefinition.js` as
`TEXT_QUERY_OPERATOR`, deliberately kept SEPARATE from `FIELD_OPERATOR`
(`entityDefinition.js`) rather than added to it:

| Operator | Meaning | A Firestore query it corresponds to |
|---|---|---|
| `TEXT_EXACT` | Exact string match. | A plain equality query (`field == value`). Kept as its own operator rather than aliased to `EQUALS` because a surface asking for it is asking for *search-box* UX (present a single text input, run it as a query), not a structured equality filter a form field would use — even though today's only backend serves both identically underneath. |
| `TEXT_PREFIX` | "Starts with." | A range query: `field >= value AND field < value + ''` (the standard Firestore prefix-range idiom — `` is a very-high-codepoint character, so the range captures everything beginning with `value`). |
| `TEXT_CONTAINS` | Substring anywhere in the field. | **Nothing.** Firestore has no substring predicate; a range scan over an ordered index cannot produce "anywhere," only "starts with." |
| `TEXT_SEARCH` | Multi-term, relevance-ranked search. | **Nothing.** This is what a real search index (inverted index, tokenization, ranking) is for, and Firestore is not one. |

`TEXT_EXACT` and `TEXT_PREFIX` are real predicates against an ordered field index.
`TEXT_CONTAINS` and `TEXT_SEARCH` are not predicates Firestore's query model can express
at all — not "slower," not "needs a bigger index," genuinely inexpressible without
either reading unbounded documents client-side (the §9 violation this program forbids)
or a different kind of index that Firestore does not maintain.

**Do not read this table as Firestore supporting arbitrary substring search under the
right conditions.** It does not. The only sub-string-shaped thing Firestore's native
query model offers is a prefix range, which is `TEXT_PREFIX`, and that is the entire
list.

## How a surface declares backend support

A `makeFilter()` call now accepts an optional `textBackend`:

```js
makeFilter({
  fieldId: "name",
  operators: ["TEXT_PREFIX"],
  textBackend: "FIRESTORE_NATIVE",
})
```

`textBackend` names the concrete backend that will serve the text operator(s) on this
filter. It is the mechanism the Owner ruling calls for: *"each surface/backend must
explicitly support the requested semantic."* Declaring `TEXT_PREFIX` in `operators`
without a `textBackend` is not a lighter-weight declaration — it is rejected (see next
section), because an operator with no named executor is exactly the "declares something
nothing consumes" defect this program exists to catch.

`TEXT_QUERY_BACKEND` (also in `listViewDefinition.js`) is the list of backends that
exist. Today it has exactly one member: `FIRESTORE_NATIVE`. `TEXT_BACKEND_CAPABILITY`
maps each backend to the operators it can execute honestly:

```js
export const TEXT_BACKEND_CAPABILITY = Object.freeze({
  FIRESTORE_NATIVE: Object.freeze(["TEXT_EXACT", "TEXT_PREFIX"]),
});
```

`supportsTextOperator(backend, operator)` is the exported predicate both the validator
and any future caller use to ask this question. There is exactly one place this
capability matrix lives; nothing duplicates or re-derives it.

## What happens when an unsupported operator is declared

`validateListViewDefinition()` (same file) checks every filter's operators. For each
operator in `TEXT_QUERY_OPERATOR`:

1. No `textBackend` declared → **validation problem**, at definition time:
   `filter "X" declares text operator "TEXT_EXACT" but no textBackend — declaring a
   text operator does not make it executable`.
2. `textBackend` names something not in `TEXT_QUERY_BACKEND` → **validation problem**:
   `textBackend "X" is not a known TEXT_QUERY_BACKEND`.
3. `textBackend` is known but cannot serve this operator (e.g. `TEXT_CONTAINS` against
   `FIRESTORE_NATIVE`) → **validation problem**, naming both the operator and what the
   backend *can* serve:
   `filter "X" declares text operator "TEXT_CONTAINS" against backend
   "FIRESTORE_NATIVE", which cannot execute it honestly at enterprise scale —
   FIRESTORE_NATIVE supports [TEXT_EXACT, TEXT_PREFIX] only.`

There is no fourth outcome. In particular, there is no code path that takes an
unsupported operator and substitutes a supported one — no `TEXT_CONTAINS` request is
ever quietly served as `TEXT_PREFIX`. The rejection happens in the same function, at the
same point in the pipeline, as every other promise-keeping check this validator already
performs (readCallable scope mismatches, unfilterable fields, ungrooved sorts) — a
declaration a real surface author would hit the moment they wrote it, in a test or in CI,
never the first time a user's search box returns wrong results.

**Today, this means `TEXT_CONTAINS` and `TEXT_SEARCH` cannot be declared on any real
list at all**, because `FIRESTORE_NATIVE` is the only backend and it cannot serve them.
That is the honest state of the world, not a bug in this seam: Parts' substring search
still cannot migrate onto this runtime until a backend that can serve `TEXT_CONTAINS` or
`TEXT_SEARCH` is added to `TEXT_QUERY_BACKEND`. This lane makes that gap *expressible and
loud* (a specific, named, rejected declaration) instead of *silent* (no vocabulary to
even attempt it). It does not close it.

## What a future provider would have to satisfy

Adding a real search backend is future work, explicitly out of scope here (no vendor is
selected, no client is added, no dependency changes). Whoever does that work must, at
minimum:

1. **Add a name to `TEXT_QUERY_BACKEND`.** That array is the single switch that turns
   "declared" into "executable" — nothing else in this file may be edited to fake it.
2. **Declare that backend's real capability in `TEXT_BACKEND_CAPABILITY`.** Be honest
   about what it can and cannot serve; a backend that only does prefix matching still
   only gets `TEXT_PREFIX`, even if it also happens to be a "search" product.
3. **Supply an execution path**, symmetrical to how `callableListSource.js` and
   `firestoreListSource.js` today implement the two `readVia` strategies
   (`CLIENT_DIRECT`/`CALLABLE`) that `useMetadataList.js` dispatches on. A `textBackend`
   is metadata declaring *which* execution path a query needs; the runtime work of
   routing to it — a query planner branch, a new `readVia`-shaped strategy, or an
   extension of an existing one — is exactly the kind of provider implementation this
   lane deliberately does not build. `listViewDefinition.js` stays a pure declaration
   layer per its own governing rule ("A definition is DATA. It never queries, never
   renders, never authorizes.") — the seam is the contract a provider must honor, not
   provider code.
4. **Not require a Firestore composite index for its own results.** See "Index-
   derivation impact" below — a non-Firestore backend manages its own indexing, and
   `requiredIndexes()` must keep excluding filters that route to it, not start
   demanding `firestore.indexes.json` entries for a predicate Firestore never runs.
5. **Preserve the no-silent-downgrade guarantee.** If the new backend also cannot serve
   every operator in `TEXT_QUERY_OPERATOR` (e.g. it does prefix and full-text but not
   exact-match reliably), its capability entry must say so and the validator's existing
   rejection path handles the rest unchanged. Nothing about adding a backend should
   require touching the rejection logic itself.

## Index-derivation impact

`requiredIndexes()` (same file) classifies every declared filter as `EQUALITY`, `RANGE`,
or `ARRAY` to compute the composite indexes Firestore needs. The text vocabulary slots
in as follows:

- **`TEXT_EXACT` needs an index, exactly like `EQUALS` does.** It classifies as
  `EQUALITY` and participates in the same composite-index math as any other equality
  filter — proven in `test/metadataListViewDefinition.test.mjs` by deriving the same
  index set from a `TEXT_EXACT` filter and an otherwise-identical `EQUALS` filter.
- **`TEXT_PREFIX` needs an index, exactly like a range operator does.** It classifies as
  `RANGE` — a prefix scan is a range scan over the field's own ordering — and produces
  the same composite-index shape as `GREATER_OR_EQUAL`/`LESS_THAN` would, proven the
  same way against `GREATER_OR_EQUAL`.
- **`TEXT_CONTAINS` and `TEXT_SEARCH` need no Firestore index and derive none.** They
  classify as a third bucket, `EXTERNAL`, which `requiredIndexes()` never folds into its
  equality/range/array index math. In practice this bucket is currently unreachable from
  a *valid* definition — no backend can serve either operator today, so
  `validateListViewDefinition()` rejects any filter that declares one before it would
  ever reach `requiredIndexes()`. The classification exists anyway so that the day a
  backend for one of them is added, `requiredIndexes()` does not start incorrectly
  demanding a Firestore composite index for a predicate Firestore was never asked to
  run — that future backend owns its own indexing (an inverted index, a hosted search
  index's own index config), not `firestore.indexes.json`.

## Additivity

Every list-view definition that existed before this lane declares zero filters with a
`textBackend` and zero `TEXT_*` operators. `test/metadataListViewDefinition.test.mjs`
proves both:

- every real, currently-registered `EntityDefinition`/`ListViewDefinition` pair under
  `field-ops-app-vite/src/metadata/definitions/` still validates with zero problems
  after this change ("ADDITIVITY: every real registered ListViewDefinition still
  validates…"), and
- no real registered filter has picked up a non-`null` `textBackend`
  ("ADDITIVITY: no real registered filter declares textBackend…").

## What this does not do

- It does not migrate Parts, or any other substring-search surface, onto the list
  runtime. `X-QUERY-MODEL-NO-FREE-TEXT` stays open until a backend exists that can
  execute `TEXT_CONTAINS` (or the product decision changes to accept `TEXT_PREFIX`
  instead, which is a different, narrower search experience and would need its own
  explicit product sign-off — not a fallback this code performs on its own).
- It does not select, evaluate, or integrate an external search vendor.
- It does not add a query-planner routing implementation. The seam — `textBackend` on a
  filter, `TEXT_QUERY_BACKEND` as the registry of what exists, `TEXT_BACKEND_CAPABILITY`
  as the honesty check — is the whole deliverable. A planner that reads `textBackend`
  and dispatches to a concrete execution strategy is provider work, not seam work.

## Future EQL note (X-EQL-INTEGRATION, not implemented here)

A future EQL compiler translating `WHERE name PREFIX 'anch'` and
`WHERE description CONTAINS 'compressor'` must compile those to *different* operators —
`TEXT_PREFIX` and `TEXT_CONTAINS` respectively — never to the same one. This vocabulary
was designed so that distinction has somewhere to land: the two SQL-ish clauses are
already two different `TEXT_QUERY_OPERATOR` members with two different, separately
validated executability stories, rather than one "text filter" concept an EQL compiler
would have to invent a distinction for after the fact.
