import { CATALOG_MUTATION_PAUSED_MESSAGE } from "../../config/catalogMutationHold.js";

// DQ-034 -- the ONE rendering of "Catalog changes are paused during the migration", shared by every catalog editing
// surface (Part Master list, New Part, Edit / Change status, Identifiers) so they cannot drift into different
// explanations of the same hold. A status, not an error: nothing failed; changes are deliberately not accepted.
export default function CatalogMutationPausedNotice() {
  return (
    <p className="fo-state fo-tone-muted fo-state-message" role="status" data-catalog-mutation-hold="DQ-034">
      {CATALOG_MUTATION_PAUSED_MESSAGE}
    </p>
  );
}
