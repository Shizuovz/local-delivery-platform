import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { proofUploadUrlSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { ProofsService } from './proofs.service';

@Controller('proofs')
export class ProofsController {
  constructor(private readonly proofsService: ProofsService) {}

  @Post('upload-url')
  createUploadUrl(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = proofUploadUrlSchema.parse(body);
    return this.proofsService.createUploadUrl(actor, input);
  }

  @Public()
  @Get(':id/file')
  signedFile(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('token') token: string,
  ) {
    return this.proofsService.signedFileAccess(id, expires, token);
  }
}
