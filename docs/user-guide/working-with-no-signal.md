# Working with no signal

## What this lets you do

Keep doing your job — recording notes, time, and installations — when you have no signal, and know exactly what has and hasn't reached the office once you're back in range.

## Who can do it

Technicians, on the Field Ops app on a phone. Everything below describes the current job screen (Field Mode) and the Sync screen that goes with it.

## Before you start

Nothing extra to set up. This is how the app already behaves — you don't turn "offline mode" on or off. It just keeps your work on the phone whenever it can't reach the platform right away.

---

## 1. What "waiting to sync" actually means

When you save something with no signal, the app does not throw it away and it does not pretend the office has it either. It keeps your entry **on the phone** and marks it **"Waiting to sync."**

That status means exactly one thing: the work is safe on this device, and the platform has not seen it yet. Nobody in the office — dispatch, your manager, the customer's file — can see it until it actually sends. If you called in to say "yeah, I noted that," but you're still standing in the basement, they don't have it yet.

The only status that means the platform has it is **"Saved"** (for a note) or **"Sent"** / **"Synced."** Anything else — "Waiting to sync," "Syncing…," "Needs attention" — means it is still only on your phone.

There is no background process quietly sending things while your phone sits in your pocket. Sync happens when:
- you get signal back and the app notices, or
- you press **Sync now**.

## 2. Recording notes, time, parts, and an installation with no signal

You can capture all of these with no signal. Here's what each screen tells you afterward.

### A note
1. On the job, tap **Add a note**.
2. Type it, or press **Dictate** — see [Dictation needs a connection](#7-dictation-needs-a-connection) below.
3. Read what's in the box. Nothing is saved until you press **Save note** — the screen says so: *"Nothing is saved until you press Save note."*
4. With no signal, after you press Save note you'll see: **"Note held on this phone — waiting to sync."**
   With signal, you'll see: **"Note saved."**

### Time
1. Enter hours and minutes and pick the type, then press **Add time**.
2. With no signal: **"Time held on this phone — waiting to sync."**
3. With signal: **"Time added."**

If the button is greyed out and you see *"You are not authorized to record labor on this work order,"* that's not a signal problem — recording time isn't turned on for your account yet. Talk to your manager.

### Parts and an installation
**Not yet.** Right now, notes and time are the two things you can capture with no signal. Recording parts used and recording an installation still need a connection — if you try either with no signal, you will get an error rather than a "waiting to sync" entry.

If you are on an installation job in a basement, the practical advice is: write down the serial, put it in a **note** (which does work offline), and record the installation itself once you are back in range.

**The rule that matters everywhere:** nothing on any of these screens ever says "saved," "installed," or "complete" because you tapped a button with no signal. Those words only appear once the platform has actually accepted the work.

## 3. How to tell whether anything is outstanding

The app is deliberately built so you are never in a situation where something is unsynced and nothing on screen says so.

- **At the top of your current job screen**, a banner always tells you where things stand:
  - **"Everything is saved"** — nothing outstanding.
  - **"1 item waiting to sync"** / **"3 items waiting to sync"** — work is on the phone, not yet sent. It also tells you what it's waiting on: *"It will send when you are back in signal"* (no signal) or *"It will send by itself"* (you have signal).
  - **"1 item needs your attention"** / **"n items need your attention"** — something was refused. See section 4.

- **Tap "View" on that banner** to open the full Sync screen — every outstanding item, what state it is in, and why.

From the banner you can also tap **Sync now** to try sending straight away rather than waiting.

## 4. When something "needs your attention"

If an entry was refused rather than just delayed, it moves to the top of your Sync screen with a **Needs review / Not accepted / Needs attention** label. Every one of these cards tells you four things:

1. **What you tried** — e.g. "Time," "Installation," "Finishing the job."
2. **What happened** — in plain terms, e.g. "That machine is already installed for another customer."
3. **What's preserved** — always: *"Your entry is saved on this phone. Nothing has been lost."*
4. **What to do next** — a specific instruction, e.g. "A manager needs to look at it," or "Try again."

Your options on the card:
- **Try again** — resend it, useful if the reason was temporary (like a job that's since been reassigned back to you, or you're now back in range).
- **Discard** — permanently delete the entry from your phone. This asks you to confirm first ("Delete this entry for good?") because it can't be undone.
- **Details** — expands to show the raw technical code and how many times it's been tried. You don't need this for your own use — it's there to read out over the phone if you call in about it.

## 5. Common conflicts, in plain words

These are the specific situations you're most likely to run into:

- **"That machine is already installed for another customer."** Check the serial on the unit in your hands. If it's right, a manager needs to look at it — don't install anything else in its place.
- **"This job is no longer assigned to you."** Your entry is still saved on the phone. Talk to dispatch before doing anything else with this job.
- **"This job is no longer in a state that accepts this"** (or *"This job had already moved on"*). It was probably finished or cancelled while you were offline. A manager can still add your entry for you.
- **"That time overlaps time you already recorded."** Check what's already logged on the job, then enter only the difference.

In every case, your entry is not gone. It stays on the phone under Sync until you (or a manager) resolve it.

## 6. Finishing an installation job with no signal

If the job is an installation, the app will not let "Finishing the job" go through until the installation itself has actually been accepted by the platform — not just entered on your phone. Until then, the job will show something like **"Waiting for the installation to be recorded first."**

This is deliberate: marking a job finished before the installation is confirmed would be saying a machine is installed at a customer site when nobody has actually confirmed that yet.

If the installation is refused (see section 5 — most often "already installed for another customer" or "not in a state that can be installed"), finishing the job stays blocked too, with **"Cannot finish the job until the installation is sorted out."** Fix the installation conflict first — resolve it with a manager if needed — and finishing the job will unblock once it goes through.

## 7. Dictation needs a connection

The **Dictate** button on a note needs a connection to turn your speech into text. Typing does not.

- If you have no signal, pressing Dictate tells you: **"Dictation needs a connection. Type the note instead — typed notes save offline."**
- If dictation fails partway through, or the phone doesn't support it, or the microphone was refused, the screen tells you which and always ends with the same fallback: type the note instead.

Whatever you dictate always lands as ordinary text you can read and edit before saving — dictation never saves anything by itself. Only your own **Save note** press does that.

## 8. "This phone is not saving work offline"

This is different from "Waiting to sync." It means your phone itself has nowhere reliable to hold your work — for example, its storage is full or the browser refused to let the app store anything locally.

If you see this warning:
- **Anything you enter may be lost if the app closes.** It is not safely queued.
- **Stay on the screen** you're working on rather than navigating away.
- **Get signal if you can** — while this warning is showing, the app will tell you on the entry screen to keep it open until you have signal, so the entry can go straight through instead of relying on local storage.
- Don't just close the app or walk away assuming it'll catch up later — with this warning up, it might not.

## 9. Signing out with work waiting

Signing out does **not** delete anything waiting on your phone. Your queued notes, time, and other entries stay on the device.

But if someone else signs in on the same phone, they will not see your queued work and it will not be sent under their session — the app checks that the entries belong to the person who's currently signed in, and refuses to send anyone else's queue. Your work sits there safely until you sign back in on that same phone to finish sending it.

Practically: if you're handing off a phone to another technician, or using a shared device, don't count on your unsynced work going out under someone else's sign-in. Sync it — or at least get it to "Waiting to sync" with signal so it can send — before you hand the phone off, if you can.

---

## Tips / common problems

- If the banner says **"n items need your attention,"** don't ignore it because the number under "waiting to sync" looks small — attention items are the ones with an actual decision needed, and they're listed separately for that reason.
- The phone's own idea of "online" is just a hint. If it says you have signal but sending still fails, that's normal — captive portals (hotel wifi, guest wifi) look connected but aren't actually reaching the platform. Press **Sync now** again once you're sure.
- "Needs your attention" is never a sign your work is lost. Every card says so.

## Related

- Sync status is the banner at the top of your current job — tap **View** on it for the full list.
