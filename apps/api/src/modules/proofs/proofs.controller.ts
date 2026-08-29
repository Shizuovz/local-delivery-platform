import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/public.decorator';
import { ProofsService } from './proofs.service';

@Controller('proofs')
export class ProofsController {
  constructor(private readonly proofsService: ProofsService) {}

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
