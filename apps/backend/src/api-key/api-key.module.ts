import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKey } from './entities/api-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  controllers: [ApiKeyController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeyModule {}
