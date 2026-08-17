import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { ACCOUNTS_COLLECTION } from "../domain/constants";
import { interpretPickerRead, PICKER_READ_CAP } from "../domain/pickerSource.js";

// BOUNDED account read for pickers.
//
// Replaces useFirestoreCollection(ACCOUNTS_COLLECTION) in the three surfaces that load
// the entire accounts collection to populate a dropdown — the Work Order wizard, the
// Opportunity form, and Equipment Register. That read has no limit at all, so at 250k
// accounts it is a quarter of a million document reads to let someone choose one, which
// is exactly the client-side dataset ownership DECISIONS #102 §9 forbids.
//
// This is NOT the accounts LIST. /customers is a separate surface with its own
// migration onto the metadata list runtime, where paging, filtering and saved views
// belong. A picker does not page — it narrows — so this deliberately has no cursor.
//
// ORDERED, not arbitrary. Truncating an unordered read returns a different subset each
// time; a user who cannot find a customer, scrolls, and retries would see the list
// change under them. Ordering by name means a truncated set is the first N by a rule
// somebody can reason about.
//
// Still a live subscription, deliberately. The bound is the governance issue; the
// subscription is how every picker in this app already behaves, and changing both at
// once would make a §9 fix indistinguishable from a behaviour change if anything
// regressed.
export function useAccountPicker({ cap = PICKER_READ_CAP } = {}) {
  const [raw, setRaw] = useState({ docs: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setRaw({ docs: null, loading: true, error: null });

    // cap + 1: the extra row is the truncation probe, mirroring the convention the
    // trusted read callables already use so client and server disclose "there is more"
    // the same way.
    const q = query(collection(db, ACCOUNTS_COLLECTION), orderBy("name"), limit(cap + 1));

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        setRaw({ docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null });
      },
      (error) => {
        if (cancelled) return;
        // docs stays null rather than becoming [], so a failed read cannot be mistaken
        // downstream for an empty collection.
        setRaw({ docs: null, loading: false, error });
      }
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [cap]);

  const picker = interpretPickerRead({ ...raw, cap });

  // The RAW error is passed through alongside the interpreted state. Consumers here
  // hand it to loadErrorMessage(), which categorizes a Firebase error code into safe
  // copy -- collapsing it to a string in this hook would have silently downgraded
  // every existing failure message to a generic one, which is the kind of regression
  // a "pure refactor" hides well.
  return { ...picker, error: raw.error, loading: raw.loading };
}
