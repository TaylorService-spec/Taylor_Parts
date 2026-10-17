from ed import edit
edit("src/access/scanWorkflows.js", [
("""  ASSIGNED_WORK_UNREADABLE: "ASSIGNED_WORK_UNREADABLE",
  // The workflow's command has not moved to EOS yet, so NO ONE can be granted it: not a permission
  // the reader lacks. DECISIONS #231 (Return intake, Owner D-SCAN-2 Option A).
  NOT_YET_IN_EOS: "NOT_YET_IN_EOS",
});""",
"""  ASSIGNED_WORK_UNREADABLE: "ASSIGNED_WORK_UNREADABLE",
});"""),
("""  // DECISIONS #231 (Owner D-SCAN-2 Option A): inventory.returns.intake has no PostgreSQL registration and
  // its command is still the Firebase callable recordReturnIntake, so under the EOS gate no principal holds
  // it and no administrator could grant it. The refusal therefore says "not yet available in EOS", never
  // "not authorized". The capability check itself is unchanged.
  if (holds(RETURNS_INTAKE_CAPABILITY)) {
    available.push({ workflow: SCAN_WORKFLOW.RETURN_INTAKE });
  } else {
    unavailable.push({ workflow: SCAN_WORKFLOW.RETURN_INTAKE, reason: UNAVAILABLE_REASON.NOT_YET_IN_EOS });
  }""",
"""  // Firebase exit F7a (DECISIONS #242) supersedes #231's "not yet available in EOS": inventory.returns.intake is
  // registered in PostgreSQL, its command is EOS recordReturnIntake, and an administrator CAN grant it (the
  // inventoryReturnsIntakeClerk Role). So a non-holder is refused as a permission they lack, like every other workflow.
  if (holds(RETURNS_INTAKE_CAPABILITY)) {
    available.push({ workflow: SCAN_WORKFLOW.RETURN_INTAKE });
  } else {
    unavailable.push({ workflow: SCAN_WORKFLOW.RETURN_INTAKE, reason: UNAVAILABLE_REASON.NO_CAPABILITY });
  }"""),
("""  [SCAN_WORKFLOW.RETURN_INTAKE]: Object.freeze({
    [UNAVAILABLE_REASON.NOT_YET_IN_EOS]:
      "Taking a return in is not yet available in EOS. This is not a permission you are missing: no one can be granted it until it moves to EOS.",
  }),""",
"""  [SCAN_WORKFLOW.RETURN_INTAKE]: Object.freeze({
    [UNAVAILABLE_REASON.NO_CAPABILITY]: "You are not authorized to take returns in. An administrator can grant it.",
  }),"""),
("""  [UNAVAILABLE_REASON.NOT_YET_IN_EOS]:
    "Not yet available in EOS. This is not a permission you are missing: no one can be granted it until it moves to EOS.",
""", ""),
])
edit("test/inventoryScanPersonaWorkflows.test.mjs", [
("""  assert.equal(reasonOf(r, RETURN_INTAKE), UNAVAILABLE_REASON.NOT_YET_IN_EOS);
});""",
"""  assert.equal(reasonOf(r, RETURN_INTAKE), UNAVAILABLE_REASON.NO_CAPABILITY);
});"""),
("""test("DECISIONS #231: Return intake is offered to no persona and is refused as NOT YET IN EOS, never as a missing permission", () => {
  for (const [persona, caps] of Object.entries(PERSONA_SCAN_CAPABILITIES)) {
    const r = workflowsFor(caps);
    assert.ok(!r.available.some((w) => (w.workflow ?? w) === RETURN_INTAKE), `${persona}: Return intake must not be offered`);
    assert.equal(reasonOf(r, RETURN_INTAKE), UNAVAILABLE_REASON.NOT_YET_IN_EOS, persona);
    const text = unavailableText(RETURN_INTAKE, reasonOf(r, RETURN_INTAKE));
    assert.match(text, /not yet available in EOS/);
    assert.match(text, /return/i, "the sentence names the workflow -- the handheld Home prints it without a label");
    assert.doesNotMatch(text, /not authorized|administrator can grant/i, persona);
  }
  // Every OTHER workflow keeps its permission wording: the new reason is Return intake's alone.
  assert.match(unavailableText(PUT_AWAY, UNAVAILABLE_REASON.NO_CAPABILITY), /not authorized/);
});""",
"""test("F7a (#242, superseding #231): Return intake is on EOS -- offered to a holder, refused to everyone else as a GRANTABLE permission", () => {
  for (const [persona, caps] of Object.entries(PERSONA_SCAN_CAPABILITIES)) {
    const r = workflowsFor(caps);
    assert.ok(!r.available.some((w) => (w.workflow ?? w) === RETURN_INTAKE), `${persona}: no manifest persona holds it yet`);
    assert.equal(reasonOf(r, RETURN_INTAKE), UNAVAILABLE_REASON.NO_CAPABILITY, persona);
    const text = unavailableText(RETURN_INTAKE, reasonOf(r, RETURN_INTAKE));
    assert.match(text, /return/i, "the sentence names the workflow -- the handheld Home prints it without a label");
    assert.match(text, /administrator can grant/i, persona);
    assert.doesNotMatch(text, /not yet available in EOS/);
  }
  const holder = workflowsFor(["inventory.returns.intake"]);
  assert.ok(holder.available.some((w) => (w.workflow ?? w) === RETURN_INTAKE), "a holder of inventory.returns.intake is offered it");
});"""),
])
