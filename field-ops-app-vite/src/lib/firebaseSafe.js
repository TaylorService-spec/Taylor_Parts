import { isWriteBlocked } from "../config/env";
import { addDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

// The one gate every Firestore write in this app passes through. When
// isWriteBlocked() is true (demo mode or panic mode -- see
// config/env.js), every write short-circuits into a warning + a
// { blocked: true } sentinel instead of touching Firestore. Reads are
// completely unaffected -- only the four mutating APIs are wrapped here.

export const safeAddDoc = async (ref, data) => {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (addDoc)", ref.path);
    return { blocked: true };
  }
  return addDoc(ref, data);
};

export const safeSetDoc = async (ref, data, options) => {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (setDoc)", ref.path);
    return { blocked: true };
  }
  return setDoc(ref, data, options);
};

export const safeUpdateDoc = async (ref, data) => {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (updateDoc)", ref.path);
    return { blocked: true };
  }
  return updateDoc(ref, data);
};

export const safeDeleteDoc = async (ref) => {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (deleteDoc)", ref.path);
    return { blocked: true };
  }
  return deleteDoc(ref);
};
