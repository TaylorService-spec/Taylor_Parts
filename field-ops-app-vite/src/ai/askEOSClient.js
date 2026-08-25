import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const askEOSRepositoryCallable = httpsCallable(functions, "askEOSRepository", { timeout: 120000 });

export async function askEOSRepository(question, { contextBudget = 4000 } = {}) {
  const result = await askEOSRepositoryCallable({ question, contextBudget });
  return result.data;
}
