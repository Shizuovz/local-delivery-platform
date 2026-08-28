import { Module } from '@nestjs/common';
import { CoreModule } from '../../common/core.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  imports: [CoreModule, DispatchModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
