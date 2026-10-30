# Sign in to Field Ops

**What this lets you do:** Get into the Field Ops app with your work account.

**Who can do it:** Anyone with a Field Ops account (admin, dispatcher, or technician).

## Before you start
- You need the email address and password for your Field Ops account. These are set up for you by an administrator — the sign-in screen has no "create account" or "sign up" option.
- If you don't have a password yet, or forgot it, you can request a reset email yourself from this screen (see below). If that doesn't work for you, contact your administrator.

## Steps
1. Open the Field Ops web address. On a wide screen you'll see two panels: a dark panel on the left with the product name and tagline, and a white card on the right with the sign-in form. On a narrow screen (phone) you'll just see the card.
2. Type your work email into the **Work email** box.
3. Type your password into the **Password** box. Click the eye icon inside the box if you want to check what you typed before submitting.
4. Click **Sign in**. The button changes to "Signing in…" while it works.
5. When sign-in succeeds, the sign-in card is replaced by the app itself, with a navigation rail down the left side for your role and your work area open on the right.

## Reset a forgotten password
1. On the sign-in card, click **Forgot password?**.
2. On the **Reset your password** screen, type the work email you sign in with and click **Send reset instructions**.
3. You'll see a confirmation message. For security, this message appears whether or not that email has an account — it never reveals whether an address is registered.
4. Check your email for the reset link. If it doesn't arrive, wait for the **Resend email** button to become available (it's on a short cooldown) and try again.
5. Click **Back to sign in** — or use your browser's Back button, which now also returns you to the sign-in form — when you're done.

## If your workspace signs in through EOS (non-production workspaces)

Some non-production workspaces (the label under the workspace name says **Sandbox**) have moved from the work-email
sign-in above to the EOS sign-in. You can tell by the field name: it says **Sign-in name**, not **Work email**.

1. Type your **Sign-in name** (your administrator tells you what it is) and your **Password**, then click **Sign in**.
2. If your account uses two-step verification, the next screen asks for the **six-digit code** from your authenticator
   app. If you cannot use the app, click **Use a recovery code instead** and enter one of the recovery codes you saved.
3. The first time (or after a reset) you have no password yet. Click **Have a setup or reset code?**, enter the code
   your administrator gave you in person or by phone, choose a password of at least 12 characters, then sign in.

### Setting up two-step verification (first time, or after your administrator resets it)

If your administrator requires two-step verification and you have not set it up, signing in takes you straight to a
**Set up two-step verification** screen instead of the app. Use **Sign out** there if you need to leave.

1. Type your password under **Your current password** and click **Set up an authenticator app**.
2. A square **QR code** appears. On your phone, open an authenticator app such as **Google Authenticator**, add an
   account, and choose to scan a QR code. Point the camera at the code on your screen. You do not type anything long.
3. Type the **six-digit code** the app now shows and click **Turn on**.
4. Save the **recovery codes** it shows (they are shown once, and each works once if you lose your phone), then click
   **I have saved them**. The app opens.

Setting up on the phone itself, or cannot scan? Tap **Open it in the authenticator app**, or type the key shown under the
code into the app by hand. If the code is refused again and again, set your phone's date and time to **automatic**:
the codes depend on the time, and a wrong phone clock is the most common cause.

There is no "email me a reset link" in this workspace. If you forget your password, ask your administrator for a
**reset code**; it works once and expires. Five wrong tries in a row lock the account for a few minutes — wait, or ask
your administrator to unlock it.

## Tips / common problems
- **"We could not sign you in with that email and password."** appears if the email or password is wrong. Re-type both carefully (watch for caps lock) and try again.
- **"No access" screen after signing in** — this means your login worked but your account hasn't been given a role yet. It shows the email you're signed in as and a **Check again** button to use once an administrator has granted access. You can't fix this yourself — contact your administrator and give them the email address shown.
- **A small label under the workspace name** (for example "Sandbox" or "Integration") means you're signed in somewhere other than the live production system — nothing you do there affects real customer data. Production shows no such label.
- **"DEMO MODE ACTIVE" banner** — if a banner across the top of the app says the app is in demo mode, nothing you do will be saved. That's expected on demo links; use your normal work link for real work.
- The bottom of the sign-in card shows a build reference — if you contact support, mentioning it helps them confirm exactly which version of the app you're using.

## Related
- Your landing screen — `your-landing-screen.md`
- Moving around the app — `navigating-field-ops.md`
- Signing out — `sign-out.md`
