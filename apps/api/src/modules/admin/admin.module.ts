import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DispatchModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
