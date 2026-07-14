import { Module } from '@nestjs/common';

import { BrowseCatalogUseCase, ManageCatalogUseCases } from './application/catalog.use-cases';
import { CATALOG_REPOSITORY } from './domain/ports/catalog.repository';
import { PrismaCatalogRepository } from './infrastructure/persistence/prisma-catalog.repository';
import { AdminCatalogController } from './presentation/admin-catalog.controller';
import { CatalogController } from './presentation/catalog.controller';

@Module({
  controllers: [CatalogController, AdminCatalogController],
  providers: [
    { provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
    BrowseCatalogUseCase,
    ManageCatalogUseCases,
  ],
  // SubscriptionsModule needs to look up an edition (to check the pincode and copy the
  // price) — the port leaves the module, not the Prisma class.
  exports: [CATALOG_REPOSITORY],
})
export class CatalogModule {}
