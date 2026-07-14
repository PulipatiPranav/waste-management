import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '@/shared/domain/errors/domain.error';
import {
  type Language,
  type Newspaper,
  type NewspaperEdition,
  type Publisher,
} from '../domain/catalog.types';
import {
  CATALOG_REPOSITORY,
  type BrowseFilter,
  type CatalogRepository,
  type CreateEditionInput,
  type CreateNewspaperInput,
  type CreatePublisherInput,
} from '../domain/ports/catalog.repository';

@Injectable()
export class BrowseCatalogUseCase {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository) {}

  /**
   * The customer-facing catalog. Returns editions, not newspapers, because the edition
   * is what carries the price and the delivery footprint — "The Hindu" is not
   * purchasable, "The Hindu, Bengaluru" is.
   */
  execute(filter: BrowseFilter): Promise<NewspaperEdition[]> {
    return this.catalog.browseEditions(filter);
  }

  async getEdition(id: string): Promise<NewspaperEdition> {
    const edition = await this.catalog.findEditionById(id);

    if (edition === null) {
      throw new NotFoundError('Newspaper edition not found');
    }

    return edition;
  }
}

@Injectable()
export class ManageCatalogUseCases {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository) {}

  // --- Publishers ----------------------------------------------------------

  createPublisher(input: CreatePublisherInput): Promise<Publisher> {
    return this.catalog.createPublisher(input);
  }

  listPublishers(): Promise<Publisher[]> {
    return this.catalog.listPublishers();
  }

  updatePublisher(
    id: string,
    input: Partial<CreatePublisherInput & { isActive: boolean }>,
  ): Promise<Publisher> {
    return this.catalog.updatePublisher(id, input);
  }

  // --- Newspapers ----------------------------------------------------------

  async createNewspaper(input: CreateNewspaperInput): Promise<Newspaper> {
    // Checked here rather than left to the FK, so the admin gets "that publisher does
    // not exist" instead of a 500 from a constraint violation.
    if (!(await this.catalog.publisherExists(input.publisherId))) {
      throw new NotFoundError('Publisher not found');
    }

    return this.catalog.createNewspaper(input);
  }

  listNewspapers(): Promise<Newspaper[]> {
    return this.catalog.listNewspapers();
  }

  updateNewspaper(
    id: string,
    input: Partial<Omit<CreateNewspaperInput, 'publisherId'> & { isActive: boolean }>,
  ): Promise<Newspaper> {
    return this.catalog.updateNewspaper(id, input);
  }

  // --- Editions ------------------------------------------------------------

  async createEdition(input: CreateEditionInput): Promise<NewspaperEdition> {
    if (!(await this.catalog.newspaperExists(input.newspaperId))) {
      throw new NotFoundError('Newspaper not found');
    }

    const existing = await this.catalog.listEditions(input.newspaperId);

    if (existing.some((edition) => edition.city.toLowerCase() === input.city.toLowerCase())) {
      throw new ConflictError(`An edition of this newspaper already exists for ${input.city}.`);
    }

    return this.catalog.createEdition(input);
  }

  listEditions(newspaperId?: string): Promise<NewspaperEdition[]> {
    return this.catalog.listEditions(newspaperId);
  }

  /**
   * Note what changing `pricePerIssuePaise` does NOT do: it does not re-price existing
   * subscriptions. Each subscription copied the price at signup
   * (`pricePerIssuePaiseAtSubscription`), so a price rise applies to new subscribers
   * only, and every past invoice still recomputes to the number it was issued at.
   */
  updateEdition(
    id: string,
    input: Partial<Omit<CreateEditionInput, 'newspaperId'>>,
  ): Promise<NewspaperEdition> {
    return this.catalog.updateEdition(id, input);
  }
}

export type { BrowseFilter, Language };
