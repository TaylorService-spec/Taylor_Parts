import { makeCollectionStore } from "../firebase/collectionStore";

// A work order is: { id, customerId, customerName, status, priority,
// scheduledDate, createdAt, updatedAt }. status is one of "open" |
// "scheduled" | "in_progress" | "closed".
//
// Work orders own the customer relationship. Jobs never own customer
// data directly -- they resolve upward: job -> workOrder -> customer.

export const workOrdersStore = makeCollectionStore("workOrders");
