// The read state hooks/useInventoryActions.js settles on when there is no Firestore handle (an EOS-only sign-in build, Firebase
// exit B2). Kept in its own module so a screen can name it without importing the hook (and so a test that mocks the hook
// does not have to re-export it).
export const INVENTORY_ACTIONS_UNAVAILABLE = "unavailable-in-this-build";
