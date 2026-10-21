// TEST SUPPORT (Q-1a). The Commercial kernels now decide OPERATING-COMPANY AUTHORITY from PostgreSQL (eosCommercial/commercialCompanyAuthority.ts).
// A suite whose subject is NOT company authority (numbering, lifecycle, catalog, finance hand-off, ...) hands the kernels this resolver through the
// TEST-INJECTION seam (`companyReach` on the command / read / transport deps): every company, company-less records included -- exactly the tenant-wide
// reach a global Commercial capability holder had before Q-1a. It is a test double and nothing in src can import it; the real resolver is proved by
// commercialCompanyAuthorityPostgres.test.mjs, and that suite also asserts the deployed server composes no such seam.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const authority = require("../../lib/eosCommercial/commercialCompanyAuthority.js");

export const ALL_COMPANIES = async () => authority.commercialCompanyReachOf({
  unrestricted: true, protectedOwner: false, companyKeys: [], employeeIds: [], creatorId: null,
});
