import {
  type Language,
  type Newspaper,
  type NewspaperEdition,
  type Publisher,
} from '../catalog.types';

export interface BrowseFilter {
  pincode?: string | undefined;
  city?: string | undefined;
  language?: Language | undefined;
}

export interface CreatePublisherInput {
  name: string;
  website: string | null;
}

export interface CreateNewspaperInput {
  publisherId: string;
  name: string;
  language: Language;
  coverImageUrl: string | null;
}

export interface CreateEditionInput {
  newspaperId: string;
  city: string;
  state: string;
  servicePincodes: string[];
  pricePerIssuePaise: number;
  isAvailable: boolean;
}

export interface CatalogRepository {
  // --- Browse (customer) ---------------------------------------------------

  /** Only available editions of active newspapers. Never returns a product nobody can buy. */
  browseEditions(filter: BrowseFilter): Promise<NewspaperEdition[]>;

  findEditionById(id: string): Promise<NewspaperEdition | null>;

  // --- Admin CRUD ----------------------------------------------------------

  createPublisher(input: CreatePublisherInput): Promise<Publisher>;
  listPublishers(): Promise<Publisher[]>;
  updatePublisher(
    id: string,
    input: Partial<CreatePublisherInput & { isActive: boolean }>,
  ): Promise<Publisher>;

  createNewspaper(input: CreateNewspaperInput): Promise<Newspaper>;
  /** Includes inactive rows: admins must be able to see and revive what they hid. */
  listNewspapers(): Promise<Newspaper[]>;
  updateNewspaper(
    id: string,
    input: Partial<Omit<CreateNewspaperInput, 'publisherId'> & { isActive: boolean }>,
  ): Promise<Newspaper>;

  createEdition(input: CreateEditionInput): Promise<NewspaperEdition>;
  listEditions(newspaperId?: string): Promise<NewspaperEdition[]>;
  updateEdition(
    id: string,
    input: Partial<Omit<CreateEditionInput, 'newspaperId'>>,
  ): Promise<NewspaperEdition>;

  publisherExists(id: string): Promise<boolean>;
  newspaperExists(id: string): Promise<boolean>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
