# See who can do what to an object

**Status: live** (admin, dispatcher) · Administration > Objects

Pick an object — Sales Orders, Work Orders, Parts Catalog — and see who can create, read, edit,
and delete it.

## Two ways to read the same thing

The Objects screen has two views:

- **By role** — pick a role, see its reach across every object. (The original view.)
- **By object** — pick an object, see which roles can act on it, and **which permission** lets
  them.

Use **By object** to answer "who can delete a Sales Order?" — previously that meant clicking
through sixteen roles and reading one column each time.

## Reading the By object table

Each verb column shows one of three things, and they mean different things:

| What you see | What it means | What to do |
|---|---|---|
| a **number** | how many roles can do it — hover to see which | nothing; this is normal |
| **nobody** | the permission exists, and no role has been given it | someone *could* be granted this |
| **—** | no permission governs this at all | it cannot be granted to anyone; don't raise a request |

A number followed by **· inert** is the one to watch: roles hold the permission, but it's
switched off system-wide, so **they still can't do it**.

## Seeing why

Click an object name. For each verb you'll see the exact permission ids behind it, whether each
is inert, and which roles hold each one.

This is the answer to "why can a Dispatcher edit that?" — it names the specific permission rather
than leaving you to infer it.

## Diagnostics

Below the table:

- **Objects the capability model does not govern** — no permission exists for any verb. Some are
  governed by database rules instead (marked as such — a different mechanism, not a hole); the
  rest are genuine gaps where the business names something the permission model doesn't cover.
- **Nobody can do it** — permissions exist and no role has them. Unlike the group above, these
  *can* be granted.
- **Held, but inert** — every permission behind these is switched off. Granting them to more
  people changes nothing.

## What this screen cannot do

Nothing here changes anything. Role definitions live in code today, and the commands that do
exist grant **roles to people**, not permissions to roles.

## Related

- [See what a role can actually do](see-what-a-role-can-do.md) — the same information, read from
  the role's side.
