// Generic shimmering placeholder rows -- used while a Firestore
// listener's first snapshot hasn't arrived yet, so a table never
// flashes empty-then-populated. `rows`/`columns` just control the
// placeholder grid size; no data awareness at all.
export default function LoadingSkeleton({ rows = 5, columns = 6 }) {
  return (
    <div className="fo-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="fo-skeleton-row" key={rowIndex}>
          {Array.from({ length: columns }, (_, colIndex) => (
            <div className="fo-skeleton-cell" key={colIndex} />
          ))}
        </div>
      ))}
    </div>
  );
}
