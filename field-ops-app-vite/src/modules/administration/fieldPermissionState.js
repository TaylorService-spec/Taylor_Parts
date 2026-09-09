// The four facts a field permission cell has to tell apart, as pure functions.
//
// Separate from the component on purpose. This is policy-DISPLAY logic — what a stored override
// means and what it resolves to — and it is the part worth proving directly, without a DOM. It also
// keeps the rule in one place: the grid, its tests and anything that later reads a cell all get the
// same answer.
//
// ════════════════════ WHY A CHECKBOX CANNOT DO THIS ════════════════════
//
//   INHERITED · Allow    no override row; the object says yes
//   INHERITED · Deny     no override row; the object says no
//   ALLOW                an override row saying true
//   DENY                 an override row saying false
//
// A checkbox has two states and there are four facts. "Inherited deny" and "explicit deny" look
// identical in one, and they behave differently the moment the object's answer changes: the first
// follows it, the second survives it.

export const INHERIT = "inherit";
export const ALLOW = "allow";
export const DENY = "deny";

/**
 * Which of the three states this field's verb is in.
 *
 * An override that says nothing about THIS verb is inherit, even when it states others — the row
 * exists for a different verb and this one still has no opinion.
 */
export function fieldVerbState(override, verb) {
  if (!override || override[verb] === undefined) return INHERIT;
  return override[verb] === true ? ALLOW : DENY;
}

/**
 * What the cell actually resolves to, in words.
 *
 * "Inherited" alone is a shrug; an administrator needs to know which way it inherited. And an
 * explicit Allow under an object the role cannot read grants NOTHING — the doorway invariant — so
 * it says so rather than rendering a cheerful Allow that does not work. The screen does not enforce
 * that; the server does. Showing it is how somebody finds out why their override is inert.
 */
export function effectiveFieldAnswer(override, verb, objectGranted) {
  const state = fieldVerbState(override, verb);
  if (state === ALLOW) return objectGranted ? "Allow" : "Allow · blocked by object";
  if (state === DENY) return "Deny";
  return objectGranted ? "Inherited · Allow" : "Inherited · Deny";
}

/**
 * Is this verb governable on this object at all?
 *
 * MEASURED, not assumed. `setObjectPermission` refuses exactly one ungoverned cell — Delete on an
 * object whose `supportsDelete` is false — and accepts every other verb. Greying out Create, Read
 * or Edit would be a UI opinion dressed as policy.
 *
 * Ungoverned inherits DOWNWARD: a field of a non-deletable object has no grantable Delete either.
 */
export const verbAvailable = (object, verb) => verb !== "D" || object?.supportsDelete === true;

/**
 * The next override after changing ONE verb, and whether the row should now be removed.
 *
 * `setFieldPermissionOverride` REPLACES the whole override, so sending only the changed verb would
 * silently drop every other explicit verb on that field — data loss that looks like a successful
 * save. An emptied override is `removeFieldPermissionOverride`, never an all-false row: "no
 * opinion" keeps having exactly one spelling.
 */
export function nextOverride(override, verb, nextState) {
  const current = { ...(override ?? {}) };
  if (nextState === INHERIT) delete current[verb];
  else current[verb] = nextState === ALLOW;
  return { override: current, remove: Object.keys(current).length === 0 };
}
