import { Injectable } from '@nestjs/common';
import { User } from '@local-delivery/types';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { ObjectStorageService } from '../../common/object-storage.service';
import { verifyProofFileToken } from '../../common/proof-file-signing';
import { PrismaService } from '../../common/prisma.service';
import { DeliveriesService } from '../deliveries/deliveries.service';

@Injectable()
export class ProofsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
    private readonly deliveriesService: DeliveriesService,
    private readonly storage: ObjectStorageService,
  ) {}

  async createUploadUrl(actor: User, input: { deliveryId: string; type: 'PHOTO' | 'SIGNATURE'; fileName: string; contentType: string }) {
    await this.deliveriesService.getDeliveryForActor(actor, input.deliveryId);
    return this.storage.createSignedUpload({
      scope: 'proofs',
      ownerId: input.deliveryId,
      fileName: input.fileName,
      contentType: input.contentType,
    });
  }

  async signedFileAccess(proofId: string, expires: string, token: string) {
    const expiresAt = Number(expires);
    if (!verifyProofFileToken(proofId, expiresAt, token)) {
      throw new ForbiddenError('Invalid or expired proof file URL');
    }

    if (this.prisma.isEnabled()) {
      const proof = await this.prisma.proof.findUnique({ where: { id: proofId } });
      if (!proof || !proof.fileUrl) throw new NotFoundError('Proof file not found');
      const signedRead = await this.storage.createSignedRead(proof.fileUrl, expiresAt - Date.now());
      if (signedRead) return { proofId, type: proof.type, ...signedRead };
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
    const signedRead = await this.storage.createSignedRead(proof.fileUrl, expiresAt - Date.now());
    if (signedRead) return { proofId, type: proof.type, ...signedRead };
    return {
      proofId,
      type: proof.type,
      storageProvider: 'mock-private',
      fileRef: proof.fileUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
}
