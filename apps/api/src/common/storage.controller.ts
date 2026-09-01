import { Controller, ForbiddenException, Put, Query } from '@nestjs/common';
import { Public } from './public.decorator';
import { ObjectStorageService } from './object-storage.service';

@Controller('storage')
export class StorageController {
  constructor(private readonly storage: ObjectStorageService) {}

  @Public()
  @Put('mock-upload')
  mockUpload(
    @Query('key') key: string,
    @Query('contentType') contentType: string,
    @Query('expires') expires: string,
    @Query('token') token: string,
  ) {
    if (!this.storage.verifyUploadUrl(key, contentType, Number(expires), token)) {
      throw new ForbiddenException('Invalid or expired storage upload URL');
    }

    return {
      stored: true,
      storageProvider: 'mock-private',
      objectKey: key,
      contentType,
      expiresAt: new Date(Number(expires)).toISOString(),
    };
  }
}
