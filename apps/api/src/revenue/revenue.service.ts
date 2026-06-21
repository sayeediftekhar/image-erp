import 'reflect-metadata';
import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import {
  RevenueService as _RevenueService,
  CloseFinalBill,
  CloseResult,
  FlaggedBalance,
  SubmitResult,
} from '@image-erp/posting-engine';
import { LedgerService } from '../ledger/ledger.service';
import { DATABASE_POOL } from '../database/database.providers';

export type { CloseFinalBill, CloseResult, FlaggedBalance, SubmitResult };

@Injectable()
export class RevenueService extends _RevenueService {
  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    ledgerService: LedgerService,
  ) {
    super(pool, ledgerService);
  }
}
