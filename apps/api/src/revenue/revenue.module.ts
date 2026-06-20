import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RevenueService } from './revenue.service';

@Module({
  imports:   [DatabaseModule, LedgerModule],
  providers: [RevenueService],
  exports:   [RevenueService],
})
export class RevenueModule {}
