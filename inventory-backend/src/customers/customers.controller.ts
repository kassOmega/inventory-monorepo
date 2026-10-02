import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { parsePaging } from '../common/pagination.util';
import { CustomersService } from './customers.service';
import {
  AdjustLoyaltyDto,
  CreateCustomerDto,
  CreateCustomerNoteDto,
  UpdateCustomerDto,
  UpdateLoyaltyProgramDto,
} from './dto/customer.dto';

const flag = (v?: string) => v === 'true' || v === '1';

/**
 * Tri-state boolean reader: `undefined` means "no filter at all", so a flag
 * filter can ask for either value (e.g. credit-eligible *or* credit-blocked).
 */
const optionalFlag = (v?: string): boolean | undefined => {
  if (v === undefined || v === '') return undefined;
  return flag(v);
};

/**
 * Customer CRM. Reads are gated on `credits.view` OR `customers.view` so the
 * roles that could already read the customer book (cashiers, storekeepers,
 * reception) keep working unchanged; writes accept `credits.manage` for the
 * same reason, and `customers.manage` for the CRM-only roles.
 */
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  @Permissions('credits.view', 'customers.view')
  findAll(
    @Query('shopId') shopId?: string,
    @Query('search') search?: string,
    @Query('onlyDebt') onlyDebt?: string,
    @Query('canTakeCredit') canTakeCredit?: string,
    @Query('tag') tag?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('archivedOnly') archivedOnly?: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.svc.findAll(shopId ? +shopId : undefined, {
      search,
      onlyDebt: flag(onlyDebt),
      canTakeCredit: optionalFlag(canTakeCredit),
      tag: tag?.trim() || undefined,
      includeArchived: flag(includeArchived),
      archivedOnly: flag(archivedOnly),
      paging: parsePaging(query),
    });
  }

  /** Directory KPIs (total, new this month, debtors, follow-ups due…). */
  @Get('overview')
  @Permissions('credits.view', 'customers.view')
  overview() {
    return this.svc.overview();
  }

  @Get('loyalty-program')
  @Permissions('credits.view', 'customers.view')
  getLoyaltyProgram() {
    return this.svc.getLoyaltyProgram();
  }

  @Put('loyalty-program')
  @Permissions('customers.manage')
  updateLoyaltyProgram(@Body() dto: UpdateLoyaltyProgramDto) {
    return this.svc.updateLoyaltyProgram(dto);
  }

  @Get(':id')
  @Permissions('credits.view', 'customers.view')
  async findOne(@Param('id') ref: string, @Query('shopId') shopId?: string) {
    return this.svc.findOne(
      await this.svc.resolveCustomerId(ref),
      shopId ? +shopId : undefined,
    );
  }

  // --- Interaction timeline ----------------------------------------------

  @Get(':id/notes')
  @Permissions('credits.view', 'customers.view')
  async listNotes(@Param('id') ref: string) {
    return this.svc.listNotes(await this.svc.resolveCustomerId(ref));
  }

  @Post(':id/notes')
  @Permissions('credits.manage', 'customers.manage')
  async addNote(
    @Param('id') ref: string,
    @Body() dto: CreateCustomerNoteDto,
    @Req() req: RequestWithUser,
  ) {
    return this.svc.addNote(
      await this.svc.resolveCustomerId(ref),
      dto,
      req.user.sub,
    );
  }

  @Delete(':id/notes/:noteId')
  @Permissions('credits.manage', 'customers.manage')
  async removeNote(
    @Param('id') ref: string,
    @Param('noteId') noteId: string,
  ) {
    return this.svc.removeNote(
      await this.svc.resolveCustomerId(ref),
      Number(noteId),
    );
  }

  // --- Loyalty ------------------------------------------------------------

  @Get(':id/loyalty')
  @Permissions('credits.view', 'customers.view')
  async loyaltyHistory(@Param('id') ref: string) {
    return this.svc.loyaltyHistory(await this.svc.resolveCustomerId(ref));
  }

  @Post(':id/loyalty/adjust')
  @Permissions('customers.manage')
  async adjustLoyalty(
    @Param('id') ref: string,
    @Body() dto: AdjustLoyaltyDto,
    @Req() req: RequestWithUser,
  ) {
    return this.svc.adjustLoyalty(
      await this.svc.resolveCustomerId(ref),
      dto,
      req.user.sub,
    );
  }

  // --- Profile CRUD -------------------------------------------------------

  @Post()
  @Permissions('credits.manage', 'customers.manage')
  create(@Body() dto: CreateCustomerDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Permissions('credits.manage', 'customers.manage')
  async update(@Param('id') ref: string, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(await this.svc.resolveCustomerId(ref), dto);
  }

  /** Archive / restore without touching the customer's history. */
  @Put(':id/archived')
  @Permissions('credits.manage', 'customers.manage')
  async setArchived(
    @Param('id') ref: string,
    @Body() body: { archived?: boolean },
  ) {
    return this.svc.setArchived(
      await this.svc.resolveCustomerId(ref),
      body?.archived !== false,
    );
  }

  @Delete(':id')
  @Permissions('credits.manage', 'customers.manage')
  async remove(@Param('id') ref: string) {
    return this.svc.remove(await this.svc.resolveCustomerId(ref));
  }
}

