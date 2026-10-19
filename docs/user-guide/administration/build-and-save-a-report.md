# Build and save a report

**Reporting → Report Builder** and **Reporting → Saved Reports**

Pick what you want to report on (customers, contacts, locations or equipment), choose the columns,
filter and sort them, run the report, and keep it for next time.

> **Permissions.** Using reports is granted by an administrator, separately for each kind of record
> (customers, contacts, locations, equipment) and separately for each saved-report action (see, create,
> rename, duplicate, delete). Until it is granted, the **Reporting** menu items do not appear:
> **Report Builder** appears when you may report on at least one kind of record, and **Saved Reports**
> appears when you may see saved reports. If you need one, ask an administrator.

## Build and run a report

1. Open **Reporting → Report Builder**. The page says **Start by Choosing an Object**.
2. Under **Object**, choose **Customer**, **Contact**, **Location** or **Equipment**. Other kinds of
   record are listed as "(coming soon)" and cannot be chosen.
3. Under **Fields**, tick the columns you want. They are grouped: the record's own fields first, then
   fields of a related record (for example **Customer (via Equipment)**). Fields marked with a small
   tag (for example "governed" or "commercial") are more sensitive, and you will only get them if your
   access includes them (see the rules below).
4. Once you have ticked at least one field, three more sections appear:
   - **Filters** — click **+ Add Report Filter**, pick the **Field**, a **Comparator**, and type a
     **Value**. Some comparators take a list (type values separated by commas) or two bounds
     (**From** and **To**). Click **Remove** to take a filter off.
   - **Group By** — tick the fields you want to group on.
   - **Sort** — under **Add Sort**, choose a field, then set **Ascending** or **Descending**.
5. Optionally, under **Summary**, tick **Count Rows**. It reads "(total)", or "(per group)" if you are
   grouping.
6. If something is missing, a box titled **Finish these to run:** lists what to fix. **Run Report**
   stays off until the list is empty.
7. Click **Run Report**. The page shows "Running the report…", then a **Results** table (and a
   **Summary** table if you counted or grouped). Each table is captioned with its row count, for example
   "Results — 12 rows". Click a column heading to sort the rows you got back.

## Save a report

1. In **Report Builder**, once the report is ready to run, type a name in **Report Name**
   ("Name this report").
2. Click **Save as New Report**. The page says: Saved "*name*". Find it in Saved Reports.

**Save as New Report always makes a new report.** There is no "overwrite". If you open a saved report,
change it and save, you get a second report; delete or rename the old one in **Saved Reports** if you
do not want both.

## Work with your saved reports

Open **Reporting → Saved Reports**. Your reports are listed with the date each was last updated.

| To do this | Do this | You see |
|---|---|---|
| Open one | Click **Open** | The report loads into **Report Builder**, ready to run |
| Rename | Click **Rename**, type the new name, click **Save** (or **Cancel**, or press Escape) | "Report renamed." |
| Duplicate | Click **Duplicate** | "Report duplicated." |
| Delete | Click **Delete**, then **Confirm Delete** (or **Cancel**) | "Report deleted." |
| Start a new one | Click **New Saved Report** | "Report created." — a starter report called "Untitled report" listing customer names; rename it, then open it to build it out |

Buttons you are not allowed to use are not shown. The list is refreshed from the system after every
change, so what you see is what was really saved.

When you open a report and part of it no longer exists (a column that was withdrawn, for example), the
builder says so, drops that part rather than quietly keeping it, and says "Some columns or options are
no longer valid — fix them below before running." If a report cannot be opened at all, you get
"*name*" can't be opened with the reason.

## What to expect: the rules

**You only see columns you are allowed to see.** A column you may not read is simply left out of the
results, and the screen says so: "Columns you can't view were left out: …". If a saved report has a
filter on a column you may not read, that filter is ignored, so the results can be wider than the report
was meant to be. The screen says that too, for example "1 filter you can't view was not applied, so this
result is wider than the saved report." The headline reads **Showing what you can view**.

**Equipment is limited to your operating companies.** You see only equipment belonging to the
operating companies you work for. Another company's machines never appear. Customers, contacts and
locations are not limited by company.

**Some columns are not available in reports yet.** Customer **Notes**, customer **Account owner** and
location **Access notes** are not available in reports yet. They may be listed among the fields, but
their values are not returned.

**A report that is too big is refused, not shown wrong.** If a report would have to look through more
than 20,000 records, the system cannot check all of them. Totals and counts are refused rather than
shown understated, and an empty result from such a large check is refused rather than reported as "no
results", because matches might exist in the records it did not reach. In both cases you see
**This report couldn't be completed**:

> This report read records but there were too many to finish checking, so the result couldn't be proven
> complete and isn't shown. Narrow the report — add a filter or a shorter date range — and run it again.
> Nothing was changed.

If a report is cut off but still shows some rows, it says "This result was cut off and isn't complete."
(or "Showing the first N rows — this result was cut off and isn't complete."). Treat those rows as a
sample, not the full answer.

**You only see your own saved reports.** You can see, open, rename, duplicate and delete only reports
you saved yourself. Someone else's report behaves as if it does not exist ("That report no longer
exists."). Saving a report does not give you access to the data in it; every run is checked against
your own access, so a report built by someone with wider access shows you only what you may see.

**Every run is recorded.** The system keeps a record of who ran which report and when. It never keeps
the data the report returned.

## If something goes wrong

| You see | What it means | What to do |
|---|---|---|
| **You don't have access to this report** — "Your role doesn't allow viewing this data. Ask an administrator if you need access." | Your access does not cover this kind of record. | Ask an administrator. |
| **We couldn't establish which operating company this report is for** | Your account is not tied to an operating company for this data, so nothing was read. This is not a missing permission. | Ask an administrator to confirm which operating company your access applies to. |
| **This report couldn't be completed** | Too many records to check (see above). | Add a filter or shorter date range and run again. |
| **No matches in the records we could read** | Records were read but not all could be checked, so "none" is not proven. | Narrow the report and run again. |
| **No matching records** — "This report ran successfully but no records matched." | A complete check found nothing. | Loosen your filters if you expected results. |
| **Part of this report is no longer available** | A field or option has been withdrawn. | Remove it and run again. |
| **This report couldn't run** — "Something went wrong running this report. Try again in a moment." | A general failure. | Try again shortly. |
| **This report's result couldn't be shown** | The app does not recognise the answer it got back. Nothing was changed. | Reload and run again; tell an administrator if it keeps happening. |
| **Reports aren't available yet** — "Running reports isn't available yet. Nothing was read or changed." | The report service cannot be reached from here. | Try again later. |
| **Saved Reports Aren't Available** — "You don't have access to saved reports." | Your access does not include saved reports. | Ask an administrator. |
| **Couldn't load saved reports** | A temporary problem. | Click **Try Again**. |
| "That report couldn't be saved — check the name and try again." | The name was refused. | Use a different name. |
| "That report no longer exists." | It was deleted, or it is not yours. | The list refreshes; carry on. |
| "Saved reports aren't available right now. Try again shortly." | A temporary problem. | Click **Refresh** and try again. |

## Tips

- Run a small report first, then add columns and filters; it is easier to see what changed.
- Reports are read-only. Running one never changes a customer, contact, location or machine.
- The domain pages under Reporting (Executive, Service, Inventory and so on) are not available; build
  what you need in Report Builder.

## Related

- [Browse and search customers](../accounts-customers/browse-and-search-customers.md)
- [Performance goals](../performance-goals.md)
- [Import data from a file](./import-data-from-a-file.md)
