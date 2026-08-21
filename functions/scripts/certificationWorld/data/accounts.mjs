// PHOENIX-METRO ACCOUNTS — real public business identities, entirely synthetic operations.
//
// ============================ THE PROVENANCE RULE ============================
//
// Provenance is recorded PER FIELD, not per record, because a record here is a mixture and
// flattening it to one label would be a false claim either way.
//
//   PUBLIC     business name, city, state, category -- publicly listed facts, retrieved 2026-08-21
//              from Yelp/Phoenix New Times/Axios/VisitPhoenix listings and the businesses' own
//              category descriptions.
//   SYNTHETIC  everything else on the record and everything downstream of it: street address, phone,
//              website, contacts, equipment ownership, serials, dates, orders, service history.
//
// Street addresses and phone numbers are DELIBERATELY synthetic even for real businesses. Publishing
// a real address attached to synthetic equipment ownership is the exact implication the brief forbids,
// and a certification dataset gains nothing from a real street number. Every such record also carries
// SYNTHETIC_OWNERSHIP_DISCLAIMER so the statement travels with the data.
//
// ============================ DETERMINISM ============================
//
// No randomness anywhere. Every derived value is a pure function of the record's index, so two seeds
// of the same version produce byte-identical data and a diff between runs means a real change.
import { PROVENANCE } from "../manifest.mjs";

// Real municipalities in the Phoenix metropolitan area. Public geographic fact.
export const METRO_CITIES = Object.freeze([
  "Phoenix", "Scottsdale", "Mesa", "Chandler", "Gilbert", "Tempe", "Glendale", "Peoria",
  "Queen Creek", "Goodyear", "Surprise", "Avondale", "Paradise Valley", "San Tan Valley",
  "Buckeye", "Fountain Hills", "Litchfield Park", "Apache Junction",
]);

/**
 * Businesses whose NAME and CITY are real public listings.
 *
 * `locations` is the number of certification Locations to create for that Account. Where a business
 * genuinely operates multiple locations in the Valley (Handel's, Dairy Queen, Jeremiah's) that is reflected,
 * which is what supplies the multi-location Account structures without inventing a chain.
 */
export const REAL_BUSINESSES = Object.freeze([
  { name: "ONYX Ice Cream", city: "Phoenix", category: "ICE_CREAM_SHOP", locations: 1 },
  { name: "Novel Ice Cream", city: "Phoenix", category: "ICE_CREAM_SHOP", locations: 2 },
  { name: "Churn", city: "Phoenix", category: "ICE_CREAM_SHOP", locations: 2 },
  { name: "Handel's Homemade Ice Cream", city: "Phoenix", category: "ICE_CREAM_CHAIN", locations: 6 },
  { name: "Bruster's Real Ice Cream", city: "Phoenix", category: "ICE_CREAM_CHAIN", locations: 2 },
  { name: "The Yard Milkshake Bar", city: "Phoenix", category: "DESSERT_BAR", locations: 1 },
  { name: "Jeremiah's Italian Ice", city: "Chandler", category: "ITALIAN_ICE_CHAIN", locations: 3 },
  { name: "Rita's Italian Ice", city: "Phoenix", category: "ITALIAN_ICE_CHAIN", locations: 2 },
  { name: "Dairy Queen", city: "Phoenix", category: "QSR_SOFT_SERVE", locations: 8 },
  { name: "Culver's", city: "Phoenix", category: "QSR_FROZEN_CUSTARD", locations: 3 },
  { name: "Mister Softee of Arizona", city: "Phoenix", category: "MOBILE_SOFT_SERVE", locations: 1 },
  { name: "Soda Jerk", city: "Phoenix", category: "SODA_FOUNTAIN", locations: 1 },
  { name: "Lix Uptown Ice Cream", city: "Phoenix", category: "ICE_CREAM_SHOP", locations: 1 },
  { name: "I-Guana Ice Cream", city: "Mesa", category: "ICE_CREAM_SHOP", locations: 1 },
  { name: "Peace Cream", city: "Phoenix", category: "ICE_CREAM_SHOP", locations: 1 },
  { name: "Dessert in Desert", city: "Phoenix", category: "DESSERT_BAR", locations: 1 },
  { name: "Shakes & Cones", city: "Phoenix", category: "DESSERT_BAR", locations: 1 },
  { name: "Desert Swirl Frozen Yogurt", city: "Phoenix", category: "FROZEN_YOGURT", locations: 1 },
  { name: "Iced Out Ice Cream", city: "Phoenix", category: "ICE_CREAM_SHOP", locations: 1 },
  { name: "Premium Matcha Cafe Maiko", city: "Phoenix", category: "DESSERT_CAFE", locations: 1 },
  { name: "Arizona Biltmore, LXR Hotels & Resorts", city: "Phoenix", category: "RESORT", locations: 3 },
  { name: "JW Marriott Scottsdale Camelback Inn", city: "Scottsdale", category: "RESORT", locations: 3 },
  { name: "Fairmont Scottsdale Princess", city: "Scottsdale", category: "RESORT", locations: 4 },
  { name: "Royal Palms Resort & Spa", city: "Phoenix", category: "RESORT", locations: 2 },
  { name: "Sanctuary Camelback Mountain", city: "Paradise Valley", category: "RESORT", locations: 2 },
]);

// Invented operators, placed in real municipalities. Names are deliberately not close to any real
// Valley business, so a reader cannot mistake one for a listing.
const SYNTHETIC_STEMS = Object.freeze([
  "Saguaro", "Papago", "Estrella", "Verrado", "Ahwatukee", "Tatum", "Camelback", "Deer Valley",
  "South Mountain", "Encanto", "Arcadia", "Roosevelt Row", "Grand Canal", "Rio Salado",
  "Superstition", "Usery Pass", "White Tank", "Sonoran", "Ocotillo", "Mesquite", "Palo Verde",
  "Ironwood", "Chaparral", "Thunderbird", "Cave Creek",
]);
const SYNTHETIC_SUFFIXES = Object.freeze([
  "Creamery", "Frozen Custard Co.", "Soda Works", "Scoop House", "Chill Bar",
  "Hospitality Group", "Food Hall", "Concession Group", "Golf Club", "Event Center",
]);
const SYNTHETIC_CATEGORIES = Object.freeze([
  "ICE_CREAM_SHOP", "QSR_SOFT_SERVE", "DESSERT_BAR", "HOSPITALITY_GROUP",
  "FOOD_HALL", "CONCESSIONS", "GOLF_CLUB", "EVENT_VENUE",
]);

/** Deterministic synthetic operators. Index-derived only -- no randomness, ever. */
export function syntheticBusinesses(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const stem = SYNTHETIC_STEMS[i % SYNTHETIC_STEMS.length];
    const suffix = SYNTHETIC_SUFFIXES[Math.floor(i / SYNTHETIC_STEMS.length) % SYNTHETIC_SUFFIXES.length];
    out.push({
      name: `${stem} ${suffix}`,
      city: METRO_CITIES[i % METRO_CITIES.length],
      category: SYNTHETIC_CATEGORIES[i % SYNTHETIC_CATEGORIES.length],
      // A few deliberately larger operators, so multi-location structure is not only a real-chain artifact.
      locations: i % 11 === 0 ? 4 : i % 5 === 0 ? 2 : 1,
    });
  }
  return out;
}

export const FIELD_PROVENANCE = Object.freeze({
  real: Object.freeze({ name: PROVENANCE.PUBLIC, city: PROVENANCE.PUBLIC, state: PROVENANCE.PUBLIC,
                        category: PROVENANCE.PUBLIC, addressLine1: PROVENANCE.SYNTHETIC,
                        phone: PROVENANCE.SYNTHETIC, website: PROVENANCE.SYNTHETIC }),
  synthetic: Object.freeze({ name: PROVENANCE.SYNTHETIC, city: PROVENANCE.PUBLIC, state: PROVENANCE.PUBLIC,
                             category: PROVENANCE.SYNTHETIC, addressLine1: PROVENANCE.SYNTHETIC,
                             phone: PROVENANCE.SYNTHETIC, website: PROVENANCE.SYNTHETIC }),
});
