import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { WebsiteAnalyticsService } from '../../services/website-analytics/website-analytics.service';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

class AuthorizeWebsiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reconnectId?: string;
}
class WebsiteCallbackDto {
  @IsString()
  @MaxLength(64)
  state: string;
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;
}
class BindWebsitesDto {
  @IsString()
  @MaxLength(64)
  ticket: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  siteUrls: string[];
}

@Controller('/website-analytics')
export class WebsiteAnalyticsController {
  constructor(private readonly service: WebsiteAnalyticsService) {}

  @Get()
  list(@GetOrgFromRequest() org: Organization) {
    return this.service.list(org.id);
  }

  @Post('/authorize')
  authorize(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: AuthorizeWebsiteDto
  ) {
    return this.service.authorize(org.id, user.id, body.reconnectId);
  }

  @Post('/callback')
  callback(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: WebsiteCallbackDto
  ) {
    return this.service.callback(
      org.id,
      user.id,
      body.state,
      body.code,
      body.error
    );
  }

  @Post('/connections')
  bind(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BindWebsitesDto
  ) {
    return this.service.bind(org.id, user.id, body.ticket, body.siteUrls);
  }

  @Delete('/connections/:id')
  disconnect(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this.service.disconnect(org.id, id);
  }

  @Get('/connections/:id/report')
  report(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('dimension') dimension?: string,
    @Query('page') page?: string
  ) {
    return this.service.report(
      org.id,
      id,
      startDate,
      endDate,
      dimension,
      page === undefined ? 0 : Number(page)
    );
  }
}
