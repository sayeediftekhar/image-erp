import { Module } from '@nestjs/common';
import { LedgerModule } from './ledger/ledger.module';
import { RevenueModule } from './revenue/revenue.module';

@Module({ imports: [LedgerModule, RevenueModule] })
export class AppModule {}
