// src/finance/finance.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import {
  CreateAccountDto,
  CreateExpenseDto,
  CreateIncomeDto,
  CreateJournalEntryDto,
  UpdateAccountDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
  UpsertAccountMappingDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

@Controller('finance')
@Permissions('finance.view')
export class FinanceController {
  constructor(private finance: FinanceService) {}

  @Get('accounts')
  listAccounts() {
    return this.finance.listAccounts();
  }

  @Get('account-mappings')
  getAccountMappings() {
    return this.finance.getAccountMappings();
  }

  @Put('account-mappings/:transactionType')
  @Permissions('finance.manage')
  setAccountMapping(
    @Param('transactionType') transactionType: string,
    @Body() dto: UpsertAccountMappingDto,
  ) {
    return this.finance.setAccountMapping(
      transactionType,
      dto.debitAccountId ?? null,
      dto.creditAccountId ?? null,
    );
  }

  @Delete('account-mappings/:transactionType')
  @Permissions('finance.manage')
  resetAccountMapping(@Param('transactionType') transactionType: string) {
    return this.finance.resetAccountMapping(transactionType);
  }

  @Post('accounts')
  @Permissions('finance.manage')
  createAccount(@Body() dto: CreateAccountDto) {
    return this.finance.createAccount(dto);
  }

  @Patch('accounts/:id')
  @Permissions('finance.manage')
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountDto) {
    return this.finance.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  @Permissions('finance.manage')
  deleteAccount(@Param('id', ParseIntPipe) id: number) {
    return this.finance.deleteAccount(id);
  }

  @Get('expenses')
  listExpenses(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.finance.listExpenses(startDate, endDate);
  }

  @Post('expenses')
  @Permissions('finance.manage')
  createExpense(@Body() dto: CreateExpenseDto, @Req() req: RequestWithUser) {
    return this.finance.createExpense(dto, req.user.sub);
  }

  @Patch('expenses/:id')
  @Permissions('finance.manage')
  updateExpense(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExpenseDto) {
    return this.finance.updateExpense(id, dto);
  }

  @Delete('expenses/:id')
  @Permissions('finance.manage')
  deleteExpense(@Param('id', ParseIntPipe) id: number) {
    return this.finance.deleteExpense(id);
  }

  @Get('incomes')
  listIncomes(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.finance.listIncomes(startDate, endDate);
  }

  @Post('incomes')
  @Permissions('finance.manage')
  createIncome(@Body() dto: CreateIncomeDto, @Req() req: RequestWithUser) {
    return this.finance.createIncome(dto, req.user.sub);
  }

  @Patch('incomes/:id')
  @Permissions('finance.manage')
  updateIncome(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIncomeDto) {
    return this.finance.updateIncome(id, dto);
  }

  @Delete('incomes/:id')
  @Permissions('finance.manage')
  deleteIncome(@Param('id', ParseIntPipe) id: number) {
    return this.finance.deleteIncome(id);
  }

  @Get('journal')
  listJournalEntries() {
    return this.finance.listJournalEntries();
  }

  @Post('journal')
  @Permissions('finance.manage')
  createJournalEntry(@Body() dto: CreateJournalEntryDto, @Req() req: RequestWithUser) {
    return this.finance.createJournalEntry(dto, req.user.sub);
  }

  @Get('gl/journal')
  getGlJournal(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('source') source?: string,
    @Query('locationId') locationId?: string,
    @Query('moduleSource') moduleSource?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.finance.getGlJournal({
      startDate,
      endDate,
      accountId: accountId ? Number(accountId) : undefined,
      source,
      locationId: locationId ? Number(locationId) : undefined,
      moduleSource,
      status,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('gl/trial-balance')
  getGlTrialBalance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
    @Query('moduleSource') moduleSource?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.finance.getGlTrialBalance({
      startDate,
      endDate,
      locationId: locationId ? Number(locationId) : undefined,
      moduleSource,
      status,
      search,
    });
  }

  @Get('gl/accounts/:id')
  getGlAccountLedger(
    @Param('id', ParseIntPipe) id: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
    @Query('moduleSource') moduleSource?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.finance.getGlAccountLedger(id, {
      startDate,
      endDate,
      locationId: locationId ? Number(locationId) : undefined,
      moduleSource,
      status,
      search,
    });
  }

  @Get('gl/coverage')
  getGlCoverage(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.finance.getGlCoverage({ startDate, endDate });
  }

  @Get('profit-loss')
  getProfitAndLoss(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.finance.getProfitAndLoss(startDate, endDate);
  }

  @Get('profit-by-category')
  getProfitByCategory(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.finance.getProfitByCategory(
      startDate,
      endDate,
      categoryId ? Number(categoryId) : undefined,
    );
  }

  @Get('category-breakdown')
  getCategoryBreakdown(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoryId') categoryId?: string,
    @Query('parentCategoryId') parentCategoryId?: string,
    @Query('locationId') locationId?: string,
    @Query('businessType') businessType?: string,
  ) {
    return this.finance.getCategoryBreakdown({
      startDate,
      endDate,
      categoryId: categoryId ? Number(categoryId) : undefined,
      parentCategoryId: parentCategoryId ? Number(parentCategoryId) : undefined,
      locationId: locationId ? Number(locationId) : undefined,
      businessType: businessType ?? 'RETAIL',
    });
  }

  @Get('itemized-performance')
  getItemizedPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
    @Query('businessType') businessType?: string,
  ) {
    return this.finance.getItemizedPerformance({
      startDate,
      endDate,
      locationId: locationId ? Number(locationId) : undefined,
      businessType: businessType ?? 'RETAIL',
    });
  }

  @Get('expense-ledger')
  getExpenseLedger(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.finance.getExpenseLedger(startDate, endDate);
  }

  @Get('comparison')
  getComparison(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('groupBy') groupBy?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.finance.getComparison(
      startDate,
      endDate,
      (groupBy as 'day' | 'week' | 'month') ?? 'day',
      locationId ? Number(locationId) : undefined,
    );
  }

  @Get('expense-summary')
  getExpenseSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.finance.getExpenseSummary(startDate, endDate);
  }

  @Get('operational-summary')
  getOperationalSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.finance.getOperationalSummary(startDate, endDate);
  }
}
