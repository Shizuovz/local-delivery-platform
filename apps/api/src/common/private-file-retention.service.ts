import { Injectable } from '@nestjs/common';
import { InMemoryStore } from './in-memory-store';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrivateFileRetentionService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  async cleanupExpiredPrivateFiles(now = new Date()) {
    if (this.prisma.isEnabled()) {
      const [proofs, riderDocuments] = await Promise.all([
        this.prisma.proof.updateMany({
          where: {
            fileUrl: { not: null },
            retentionExpiresAt: { lt: now },
          },
          data: { fileUrl: null },
        }),
        this.prisma.riderDocument.updateMany({
          where: {
            fileUrl: { not: null },
            retentionExpiresAt: { lt: now },
          },
          data: {
            fileUrl: null,
            status: 'EXPIRED',
          },
        }),
      ]);
      return { proofsExpired: proofs.count, riderDocumentsExpired: riderDocuments.count };
    }

    let proofsExpired = 0;
    let riderDocumentsExpired = 0;
    const nowMs = now.getTime();

    for (const proof of this.store.proofs.values()) {
      if (proof.fileUrl && proof.retentionExpiresAt && Date.parse(proof.retentionExpiresAt) < nowMs) {
        proof.fileUrl = undefined;
        proofsExpired += 1;
      }
    }

    for (const document of this.store.riderDocuments.values()) {
      if (document.fileUrl && document.retentionExpiresAt && Date.parse(document.retentionExpiresAt) < nowMs) {
        document.fileUrl = undefined;
        document.status = 'EXPIRED';
        riderDocumentsExpired += 1;
      }
    }

    return { proofsExpired, riderDocumentsExpired };
  }
}
