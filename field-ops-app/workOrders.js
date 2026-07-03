// ---------- Work Orders ----------
//
// A work order is: { id, title, notes, createdAt }
// Work Orders are the parent grouping entity for Jobs. Jobs reference
// their work order via workOrderId; work orders never embed job data.

function WorkOrdersView() {
  const [workOrders, setWorkOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    const unsubscribe = window.FieldOps.workOrdersStore.onChange((rows) => {
      setWorkOrders(rows);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  function addWorkOrder(e) {
    e.preventDefault();
    if (!title.trim()) return;
    window.FieldOps.workOrdersStore.add({ title: title.trim(), notes: notes.trim() }).then(() => {
      setTitle("");
      setNotes("");
    });
  }

  return (
    <div className="fo-panel">
      <h2>Work Orders</h2>
      <form className="fo-form" onSubmit={addWorkOrder}>
        <input placeholder="Work order title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="submit">Add Work Order</button>
      </form>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : workOrders.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.map((wo) => (
              <tr key={wo.id}>
                <td>{wo.title}</td>
                <td>{wo.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

window.FieldOps = window.FieldOps || {};
window.FieldOps.WorkOrdersView = WorkOrdersView;
