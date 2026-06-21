import 'reflect-metadata';
import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { LedgerService as _LedgerService } from '@image-erp/posting-engine';
import { DATABASE_POOL } from '../database/database.providers';

@Injectable()
export class LedgerService extends _LedgerService {
  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    super(pool);
  }
}
