import { Module } from '@nestjs/common';

import { FindUserByPhoneUseCase } from './application/use-cases/find-user-by-phone.use-case';
import { GetProfileUseCase } from './application/use-cases/get-profile.use-case';
import { UpdateProfileUseCase } from './application/use-cases/update-profile.use-case';
import { USER_REPOSITORY } from './domain/ports/user.repository';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { UsersController } from './presentation/users.controller';

@Module({
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    GetProfileUseCase,
    FindUserByPhoneUseCase,
    UpdateProfileUseCase,
  ],
  // AuthModule's guards and use cases resolve users by id on every request, so the
  // port — not the Prisma class — is what leaves this module.
  exports: [USER_REPOSITORY],
})
export class UsersModule {}
