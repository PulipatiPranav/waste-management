import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { type Newspaper, type NewspaperEdition, type Publisher } from '../../domain/catalog.types';
import {
  type BrowseFilter,
  type CatalogRepository,
  type CreateEditionInput,
  type CreateNewspaperInput,
  type CreatePublisherInput,
} from '../../domain/ports/catalog.repository';

const editionInclude = {
  newspaper: { include: { publisher: true } },
} satisfies Prisma.NewspaperEditionInclude;

type EditionRow = Prisma.NewspaperEditionGetPayload<{ include: typeof editionInclude }>;
type NewspaperRow = Prisma.NewspaperGetPayload<{ include: { publisher: true } }>;

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Browse --------------------------------------------------------------

  async browseEditions(filter: BrowseFilter): Promise<NewspaperEdition[]> {
    const rows = await this.prisma.newspaperEdition.findMany({
      where: {
        // Hard-wired, not caller-supplied: the browse endpoint must never surface an
        // edition that cannot actually be subscribed to. A customer who can see it will
        // try to buy it.
        isAvailable: true,
        newspaper: {
          isActive: true,
          ...(filter.language !== undefined ? { language: filter.language } : {}),
        },
        ...(filter.pincode !== undefined ? { servicePincodes: { has: filter.pincode } } : {}),
        // Case-insensitive: "bengaluru" and "Bengaluru" are the same city to a user
        // typing into a search box.
        ...(filter.city !== undefined
          ? { city: { equals: filter.city, mode: 'insensitive' as const } }
          : {}),
      },
      include: editionInclude,
      orderBy: [{ newspaper: { name: 'asc' } }, { city: 'asc' }],
    });

    return rows.map((row) => this.toEdition(row));
  }

  async findEditionById(id: string): Promise<NewspaperEdition | null> {
    const row = await this.prisma.newspaperEdition.findUnique({
      where: { id },
      include: editionInclude,
    });

    return row === null ? null : this.toEdition(row);
  }

  // --- Publishers ----------------------------------------------------------

  async createPublisher(input: CreatePublisherInput): Promise<Publisher> {
    return this.prisma.publisher.create({ data: input });
  }

  listPublishers(): Promise<Publisher[]> {
    return this.prisma.publisher.findMany({ orderBy: { name: 'asc' } });
  }

  updatePublisher(
    id: string,
    input: Partial<CreatePublisherInput & { isActive: boolean }>,
  ): Promise<Publisher> {
    return this.prisma.publisher.update({ where: { id }, data: input });
  }

  async publisherExists(id: string): Promise<boolean> {
    return (await this.prisma.publisher.count({ where: { id } })) > 0;
  }

  // --- Newspapers ----------------------------------------------------------

  async createNewspaper(input: CreateNewspaperInput): Promise<Newspaper> {
    const row = await this.prisma.newspaper.create({
      data: input,
      include: { publisher: true },
    });

    return this.toNewspaper(row);
  }

  async listNewspapers(): Promise<Newspaper[]> {
    // Includes inactive rows on purpose — this is the admin list, and an admin has to
    // be able to see (and revive) what they hid.
    const rows = await this.prisma.newspaper.findMany({
      include: { publisher: true },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => this.toNewspaper(row));
  }

  async updateNewspaper(
    id: string,
    input: Partial<Omit<CreateNewspaperInput, 'publisherId'> & { isActive: boolean }>,
  ): Promise<Newspaper> {
    const row = await this.prisma.newspaper.update({
      where: { id },
      data: input,
      include: { publisher: true },
    });

    return this.toNewspaper(row);
  }

  async newspaperExists(id: string): Promise<boolean> {
    return (await this.prisma.newspaper.count({ where: { id } })) > 0;
  }

  // --- Editions ------------------------------------------------------------

  async createEdition(input: CreateEditionInput): Promise<NewspaperEdition> {
    const row = await this.prisma.newspaperEdition.create({
      data: input,
      include: editionInclude,
    });

    return this.toEdition(row);
  }

  async listEditions(newspaperId?: string): Promise<NewspaperEdition[]> {
    const rows = await this.prisma.newspaperEdition.findMany({
      where: newspaperId !== undefined ? { newspaperId } : {},
      include: editionInclude,
      orderBy: [{ city: 'asc' }],
    });

    return rows.map((row) => this.toEdition(row));
  }

  async updateEdition(
    id: string,
    input: Partial<Omit<CreateEditionInput, 'newspaperId'>>,
  ): Promise<NewspaperEdition> {
    const row = await this.prisma.newspaperEdition.update({
      where: { id },
      data: input,
      include: editionInclude,
    });

    return this.toEdition(row);
  }

  // --- Mapping -------------------------------------------------------------

  private toNewspaper(row: NewspaperRow): Newspaper {
    return {
      id: row.id,
      name: row.name,
      language: row.language,
      coverImageUrl: row.coverImageUrl,
      isActive: row.isActive,
      publisher: { id: row.publisher.id, name: row.publisher.name },
    };
  }

  private toEdition(row: EditionRow): NewspaperEdition {
    return {
      id: row.id,
      city: row.city,
      state: row.state,
      servicePincodes: row.servicePincodes,
      pricePerIssuePaise: row.pricePerIssuePaise,
      isAvailable: row.isAvailable,
      newspaper: this.toNewspaper(row.newspaper),
    };
  }
}
