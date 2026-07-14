import { type Newspaper, type NewspaperEdition } from '../domain/catalog.types';
import { type EditionDto, type NewspaperDto } from './dto/catalog.dto';

/**
 * Paise -> a rupee string, for display only.
 *
 * A string, not a number: `450 / 100` is 4.5 in JavaScript, and a client that renders
 * that shows "₹4.5". More importantly, a float rupee value invites a client to do
 * arithmetic on it, which is exactly what the integer-paise convention exists to
 * prevent. The authoritative value stays alongside it, in paise.
 */
export function paiseToRupeeString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);

  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function toNewspaperDto(newspaper: Newspaper): NewspaperDto {
  return {
    id: newspaper.id,
    name: newspaper.name,
    language: newspaper.language,
    coverImageUrl: newspaper.coverImageUrl,
    isActive: newspaper.isActive,
    publisherId: newspaper.publisher.id,
    publisherName: newspaper.publisher.name,
  };
}

export function toEditionDto(edition: NewspaperEdition): EditionDto {
  return {
    id: edition.id,
    city: edition.city,
    state: edition.state,
    servicePincodes: [...edition.servicePincodes],
    pricePerIssuePaise: edition.pricePerIssuePaise,
    pricePerIssueRupees: paiseToRupeeString(edition.pricePerIssuePaise),
    isAvailable: edition.isAvailable,
    newspaper: toNewspaperDto(edition.newspaper),
  };
}
