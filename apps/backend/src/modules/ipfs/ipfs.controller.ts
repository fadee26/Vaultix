import { Controller, Get, Param, Res, Redirect, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { IpfsService } from './ipfs.service';
import { AuthGuard } from '../auth/middleware/auth.guard';

@Controller('ipfs')
export class IpfsController {
  constructor(private readonly ipfsService: IpfsService) {}

  @Get(':cid')
  @Redirect()
  async getFile(@Param('cid') cid: string) {
    const url = this.ipfsService.getGatewayUrl(cid);
    return { url, statusCode: 302 };
  }
}
