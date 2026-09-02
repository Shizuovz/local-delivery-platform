import { Module } from '@nestjs/common';
import { ServiceZonesController } from './service-zones.controller';
import { ServiceZonesService } from './service-zones.service';

@Module({
  controllers: [ServiceZonesController],
  providers: [ServiceZonesService],
  exports: [ServiceZonesService],
})
export class ServiceZonesModule {}
