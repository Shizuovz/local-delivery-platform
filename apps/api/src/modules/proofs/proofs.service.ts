import { Injectable } from '@nestjs/common';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { verifyProofFileToken } from '../../common/proof-file-signing';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ProofsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  async signedFileAccess(proofId: string, expires: string, token: string) {
    const expiresAt = Number(expires);
    if (!verifyProofFileToken(proofId, expiresAt, token)) {
      throw new ForbiddenError('Invalid or expired proof file URL');
    }

    if (this.prisma.isEnabled()) {
      const proof = await this.prisma.proof.findUnique({ where: { id: proofId } });
      if (!proof || !proof.fileUrl) throw new NotFoundError('Proof file not found');
      return {
        proofId,
        type: proof.type,
        storageProvider: 'mock-private',
        fileRef: proof.fileUrl,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    }

    const proof = this.store.proofs.get(proofId);
    if (!proof?.fileUrl) throw new NotFoundError('Proof file not found');
    return {
      proofId,
      type: proof.type,
      storageProvider: 'mock-private',
      fileRef: proof.fileUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
}
