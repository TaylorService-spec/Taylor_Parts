# SEEDED / SYNTHETIC export directory

**Not a Taylor export.** Every file here is invented, deliberately defective, and
exists only so the intake reader (`scripts/customer1-migration/read-export.mjs`)
produces a known exception for every check it makes. No value here is a Taylor
number, part number, customer, or balance.

This file itself is a fixture: it is not a `.csv`, so intake reports it as
`UNSUPPORTED_FORMAT`. An intake directory is supposed to contain exports and
nothing else, and the reader says so rather than quietly ignoring strays.

| File | What it exercises |
| --- | --- |
| `parts__SEEDED-PARTSDB.csv` | A clean read: padded values, a quoted field containing a comma and a doubled quote, a blank mapped value, and junk in a money column — all of which survive intake and become exceptions later, at the mapping stage, where they belong. |
| `inventory__SEEDED-PARTSDB.csv` | Row-level exceptions: one `RAGGED_ROW`, one `BLANK_RECORD_ID`. The other rows still read. |
| `customers__SEEDED-SERVICE-XLS.csv` | `MISSING_COLUMN` — the mapped `CUST_NAME` column is absent, so the whole file is rejected. |
| `equipment__SEEDED-SERVICE-XLS.csv` | `UNEXPECTED_COLUMN` — `INSTALL_DT` is in the export but nothing in the mapping table dispositions it. |
| `serviceHistory__SEEDED-SERVICE-XLS.csv` | `UNDECLARED_SOURCE` — a well-formed file for a domain and system the mapping table names no fields for. |
| `SEEDED-loose-export.csv` | `UNPARSEABLE_FILE_NAME` — a CSV whose name does not say which domain or system it came from. |
| `SEEDED-README.md` | `UNSUPPORTED_FORMAT`. |

The encoding checks (`ENCODING_NOT_UTF8` for a byte order mark and for invalid
UTF-8) and `MALFORMED_DELIMITED`, `DUPLICATE_COLUMN`, `MISSING_RECORD_ID_COLUMN`
and `EMPTY_FILE` are exercised in memory by
`scripts/customer1-migration/read-export.test.mjs`, because committing a
deliberately corrupt byte sequence as a repository file invites some tool along
the way to helpfully repair it.

**Seeded data proves the process. It cannot prove Taylor's data.**
