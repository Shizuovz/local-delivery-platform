import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrivateFileRetentionService } from '../common/private-file-retention.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const retention = app.get(PrivateFileRetentionService);
    const result = await retention.cleanupExpiredPrivateFiles();
    console.log(JSON.stringify({ job: 'private-file-retention.cleanup', ...result }));
  } finally {
    await app.close();
  }
}

void run();
