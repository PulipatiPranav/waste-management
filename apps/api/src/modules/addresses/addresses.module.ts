import { Module } from '@nestjs/common';

import { AddressUseCases } from './application/address.use-cases';
import { ADDRESS_REPOSITORY } from './domain/ports/address.repository';
import { PrismaAddressRepository } from './infrastructure/persistence/prisma-address.repository';
import { AddressesController } from './presentation/addresses.controller';

@Module({
  controllers: [AddressesController],
  providers: [{ provide: ADDRESS_REPOSITORY, useClass: PrismaAddressRepository }, AddressUseCases],
})
export class AddressesModule {}
