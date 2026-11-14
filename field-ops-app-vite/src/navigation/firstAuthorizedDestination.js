import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "./navConfig.js";

/** The first destination (rail order, nav-hidden items excluded) this principal may open, or null. */
export function firstAuthorizedDestination(role, allowedLegacyKeys, operationalContext) {
  for (const domain of NAV_DOMAINS) {
    if (domain.future || !isDomainVisible(domain, role, allowedLegacyKeys, operationalContext)) continue;
    const item = (domain.subnav ?? []).find(
      (i) => !i.navHidden && isNavItemVisible(i, role, allowedLegacyKeys, operationalContext),
    );
    if (item) return { label: domain.label, to: item.path ? `/${domain.path}/${item.path}` : `/${domain.path}` };
  }
  return null;
}
