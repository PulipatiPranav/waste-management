import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { RecyclingUseCases } from './application/recycling.use-cases';
import { RECYCLING_REPOSITORY } from './domain/ports/recycling.repository';
import {
  BATCHING_QUEUE,
  BatchingScheduler,
  BatchingWorker,
} from './infrastructure/jobs/batching.queue';
import { PrismaRecyclingRepository } from './infrastructure/persistence/prisma-recycling.repository';
import { AdminRecyclingController } from './presentation/admin-recycling.controller';

@Module({
  // BullModule.forRoot is registered once by DeliveryModule; registerQueue attaches to it.
  imports: [AuthModule, BullModule.registerQueue({ name: BATCHING_QUEUE })],
  controllers: [AdminRecyclingController],
  providers: [
    { provide: RECYCLING_REPOSITORY, useClass: PrismaRecyclingRepository },
    RecyclingUseCases,
    BatchingScheduler,
    BatchingWorker,
  ],
  exports: [RECYCLING_REPOSITORY],
})
export class RecyclingModule {}
