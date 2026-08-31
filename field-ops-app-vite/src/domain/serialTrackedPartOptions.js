// SERIAL-TRACKED PART OPTIONS — the pure shaping behind the acquisition picker.
//
// PURE: no Firebase, no network, no React. It lives here rather than beside the hook that reads the
// documents so it can be tested without a firebase module resolving at all, which is the same split
// every other domain/hook pair in this codebase makes.
//
// ============================ WHY THIS SET ============================
//
// `acquireSerializedAssetCommand` accepts a Part only when its resolved tracking mode is SERIAL — a
// quantity part has no individually identified units to acquire, and the command refuses it with its
// own distinct code. `SERIALIZED` is the stored controlType that maps to SERIAL, so the picker
// offers exactly what the command will take and nothing it would reject.

/** The stored controlType whose resolved tracking mode is SERIAL. */
export const SERIAL_CONTROL_TYPE = "SERIALIZED";

/**
 * One option per acquirable Part.
 *
 * THE LABEL IS NEVER THE KEY. `partId` is the document id and travels only as the option's value; a
 * person choosing a part must not be asked to recognise a database key. A Part carrying neither an
 * internal part number nor a name is DROPPED rather than offered under its id — an option labelled
 * `SKU-8Xy2` teaches somebody to memorise internal identifiers and gives them nothing they can
 * check against the machine in front of them.
 *
 * Ordered by label so the picker does not reshuffle between renders, and the input is never mutated.
 */
export function toSerialPartOptions(docs) {
  const options = [];
  for (const part of Array.isArray(docs) ? docs : []) {
    const partId = typeof part?.partId === "string" && part.partId.trim() !== "" ? part.partId.trim() : null;
    if (!partId) continue;
    const number = typeof part?.internalPartNumber === "string" && part.internalPartNumber.trim() !== ""
      ? part.internalPartNumber.trim() : null;
    const name = typeof part?.name === "string" && part.name.trim() !== "" ? part.name.trim() : null;
    if (!number && !name) continue;   // never label an option with the key
    options.push(Object.freeze({
      value: partId,
      label: number && name ? `${number} — ${name}` : (number ?? name),
    }));
  }
  options.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return Object.freeze(options);
}
