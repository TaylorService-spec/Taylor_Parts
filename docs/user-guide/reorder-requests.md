# Reorder Requests

A Reorder Request tracks one part, from "we're running low" all the way through to "the new stock arrived." It moves through several people's hands in order, and everyone involved can see exactly where it stands.

This page covers the whole journey. You'll mostly only ever do the steps for your own role — use the headings below to find yours.

## Who does what

| Role | What you do |
|---|---|
| Dispatcher / Admin | Requests a reorder when a part is running low, and reviews/approves or rejects the request |
| Parts Manager | Assigns an approved request to a Parts Associate to purchase |
| Parts Associate | Starts purchasing, records the purchase order once it's placed |
| Warehouse Manager / assignee | Marks the request received when stock arrives |

## The journey, step by step

### 1. Requesting a reorder

**As a dispatcher or admin**, go to **Inventory > Parts** and open a part that's low. If it needs reordering, you'll see a **Request Reorder** action on the Stock Position card. Click it — this creates the Reorder Request and puts it in front of whoever reviews requests next.

### 2. Reviewing the request

**As a dispatcher or admin**, open the part's detail page. If a request is waiting, you'll see a **"Reorder Request — Pending Review"** card. Review the recommended quantity and either approve or reject it. Approving moves it forward to the Parts Manager; rejecting ends it here.

You'll also see requests waiting for your review in the **Notification Panel** (top of the screen) and in the **Parts Manager Queue** on the Inventory Operational Queue.

### 3. Assigning it to be purchased

**As a Parts Manager**, once a request is approved you'll see a **"Reorder Request — Ready for Parts Manager"** card on the part's detail page. Click **Assign to Parts Associate** and pick who should handle the purchase from the list.

### 4. Starting the purchase

**As the assigned Parts Associate**, open the part — you'll see **"Reorder Request — Assigned to Parts Associate"**. Click **Start Purchasing** when you begin working the order. This moves it into your **Parts Associate Queue** ("In Progress").

While it's in progress, you can post short status updates (e.g. "called the vendor, waiting on a quote") — each update shows your name and the time, so anyone checking the request later can see who last touched it and when.

### 5. Recording the purchase order

**As the assigned Parts Associate**, once you've actually placed the order with the vendor, open the **"Reorder Request — Purchasing In Progress"** card and use **Record Purchase Order** to log the PO number, vendor, cost, and expected delivery date. This moves the request to **Ordered**.

### 6. Receiving the stock

**As the Warehouse Manager or assignee**, once the parts physically arrive, open the **"Reorder Request — Ordered"** card and click **Mark Received**. This closes the request out.

> **Note:** Marking a request received is a status update only — it does not yet update the part's live stock count in the system. That reconciliation is a known gap, tracked separately, not something you need to work around manually.

## Who did what, and when

Everywhere a Reorder Request shows who performed an action — assigned it, started purchasing, posted an update, recorded the order, received it — the screen shows that person's real name, not a raw account ID. If you ever see an unfamiliar-looking ID instead of a name, that's worth flagging — it shouldn't happen anywhere in the app.

## Logging inventory notes (not a stock change)

On a part's detail page, the **Inventory Action Log** lets you log an audit note — "received extra stock," "adjusted for a shrinkage," "corrected a mistake" — with a quantity, reason, and notes. This is a record-keeping note only: **it does not change the part's actual stock count.** Each logged entry shows who logged it and when, in the **Recent Logged Actions** table.

## Rejected requests

If a request is rejected during review, it doesn't move forward — there's nothing further to do on it. A new Reorder Request can be created later if the part is still low.
