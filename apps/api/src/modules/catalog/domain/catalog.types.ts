/** Mirrors the Prisma enum; the domain must not import @prisma/client. */
export const LANGUAGES = [
  'ENGLISH',
  'HINDI',
  'KANNADA',
  'TAMIL',
  'TELUGU',
  'MALAYALAM',
  'MARATHI',
  'BENGALI',
  'GUJARATI',
  'URDU',
  'PUNJABI',
  'ODIA',
] as const;

export type Language = (typeof LANGUAGES)[number];

export interface Publisher {
  id: string;
  name: string;
  website: string | null;
  isActive: boolean;
}

export interface Newspaper {
  id: string;
  name: string;
  language: Language;
  coverImageUrl: string | null;
  isActive: boolean;
  publisher: Pick<Publisher, 'id' | 'name'>;
}

export interface NewspaperEdition {
  id: string;
  city: string;
  state: string;
  servicePincodes: readonly string[];
  /** Integer paise. See the money convention in schema.prisma. */
  pricePerIssuePaise: number;
  isAvailable: boolean;
  newspaper: Newspaper;
}

/**
 * Whether this edition can actually be delivered to a pincode.
 *
 * On the entity rather than in a use case, because both the browse endpoint and the
 * subscribe endpoint have to ask it. If subscribe re-derived the rule, the two could
 * disagree — and the failure mode is a customer who successfully subscribes to a paper
 * that no van will ever bring them.
 */
export function servesPincode(edition: NewspaperEdition, pincode: string): boolean {
  return edition.servicePincodes.includes(pincode);
}

export function isSubscribable(edition: NewspaperEdition): boolean {
  return edition.isAvailable && edition.newspaper.isActive;
}
