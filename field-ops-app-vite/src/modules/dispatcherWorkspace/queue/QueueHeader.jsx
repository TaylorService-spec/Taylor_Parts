import { QUEUE_COLUMNS } from "./columns";

// Renders column labels purely from QUEUE_COLUMNS -- never hardcoded,
// per this phase's column-configuration requirement. The leading blank
// <th> matches QueueRow.jsx's priority-stripe cell; the trailing blank
// <th> matches its reserved scanning-slots cell -- both unlabeled since
// they're visual indicators, not data columns.
export default function QueueHeader() {
  return (
    <thead>
      <tr>
        <th aria-hidden="true" />
        {QUEUE_COLUMNS.map((col) => (
          <th key={col.key}>{col.label}</th>
        ))}
        <th aria-hidden="true" />
      </tr>
    </thead>
  );
}
