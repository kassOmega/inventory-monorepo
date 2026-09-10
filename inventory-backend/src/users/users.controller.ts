import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { parsePaging } from '../common/pagination.util';
import { AiUsageService } from '../ai/ai-usage.service';
import {
  ResetPasswordDto,
  UpdateUserStatusDto,
  UserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
@Permissions('users.manage')
export class UsersController {
  constructor(
    private service: UsersService,
    private usage: AiUsageService,
  ) {}

  @Get()
  @Permissions('users.view', 'users.manage')
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(parsePaging(query));
  }

  /** Today's AI usage for a user (count / quota / remaining) — admin view. */
  @Get(':id/ai-usage')
  async aiUsage(@Param('id') ref: string) {
    return this.usage.getUsage(await this.service.resolveUserId(ref));
  }

  @Put(':id')
  async update(
    @Param('id') ref: string,
    @Body() body: UserDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.update(
      await this.service.resolveUserId(ref),
      body,
      req.user,
    );
  }

  @Put(':id/password')
  async resetPassword(
    @Param('id') ref: string,
    @Body() body: ResetPasswordDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.resetPassword(
      await this.service.resolveUserId(ref),
      body.password,
      req.user,
    );
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') ref: string,
    @Body() body: UpdateUserStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.updateStatus(
      await this.service.resolveUserId(ref),
      body.status,
      req.user,
    );
  }

  @Delete(':id')
  async remove(@Param('id') ref: string, @Req() req: RequestWithUser) {
    return this.service.remove(await this.service.resolveUserId(ref), req.user);
  }
}
