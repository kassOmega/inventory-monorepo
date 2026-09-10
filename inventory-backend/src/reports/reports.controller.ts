import { Controller, Get, Header, Query, Req, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { ReportQueryDto } from './dto/report-query.dto';
import { StockReportQueryDto } from './dto/stock-report-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('inventory-breakdown')
  @Permissions('reports.view')
  getInventoryBreakdown(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.service.getInventoryBreakdown(
      req.user,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('inventory-overview')
  @Permissions('reports.view')
  getInventoryOverview(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.service.getInventoryOverview(
      req.user,
      query.locationId,
      query.startDate,
      query.endDate,
    );
  }

  @Get('sales-summary')
  @Permissions('reports.full')
  getSalesSummary(@Req() req: RequestWithUser, @Query() query: ReportQueryDto) {
    return this.service.getSalesSummary(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('sales-trend')
  @Permissions('reports.view')
  getSalesTrend(@Req() req: RequestWithUser, @Query() query: ReportQueryDto) {
    return this.service.getSalesTrend(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('most-sold')
  @Permissions('reports.view')
  getMostSold(@Req() req: RequestWithUser, @Query() query: ReportQueryDto) {
    return this.service.getMostSold(
      req.user,
      query.locationId,
      query.categoryId,
      query.search,
      query.startDate,
      query.endDate,
    );
  }

  @Get('low-stock')
  @Permissions('reports.view')
  getLowStock(@Req() req: RequestWithUser, @Query() query: StockReportQueryDto) {
    return this.service.getLowStock(
      req.user,
      query.search,
      query.categoryId,
      query.locationId,
    );
  }

  @Get('dead-stock')
  @Permissions('reports.view')
  getDeadStock(@Req() req: RequestWithUser, @Query() query: StockReportQueryDto) {
    return this.service.getDeadStock(
      req.user,
      query.search,
      query.categoryId,
      query.locationId,
    );
  }

  @Get('audit-trail')
  @Permissions('reports.full')
  getAuditTrail() {
    return this.service.getAuditTrail();
  }

  @Get('payment-methods-breakdown')
  @Permissions('reports.view')
  getPaymentMethodsBreakdown(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.service.getPaymentMethodsBreakdown(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('unified-stats')
  @Permissions('reports.full', 'sales.view-profit')
  getUnifiedStats(@Req() req: RequestWithUser, @Query() query: ReportQueryDto) {
    return this.service.getUnifiedStats(req.user, query.locationId, query.startDate, query.endDate, query.categoryId, query.search);
  }

  @Get('hospitality')
  @Permissions('reports.full')
  getHospitality(@Query() query: ReportQueryDto) {
    return this.service.getHospitalityReport(query.startDate, query.endDate);
  }

  @Get("manufacturing-dashboard")
  @Permissions("manufacturing.view", "reports.view")
  getManufacturingDashboard(@Query() query: ReportQueryDto) {
    return this.service.getManufacturingDashboard(query.startDate, query.endDate, query.locationId);
  }


  @Get('hospitality-dashboard')
  @Permissions('restaurant.view')
  getHospitalityDashboard(@Query() query: ReportQueryDto) {
    return this.service.getHospitalityDashboard(query.startDate, query.endDate);
  }

  // Staff & Station activity audit — full order chain with explicit order IDs.
  @Get('hospitality-activity')
  @Permissions('reports.full')
  getHospitalityActivity(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('station') station?: string,
    @Query('userId') userId?: string,
  ) {
    return this.service.getHospitalityActivity(startDate, endDate, station, userId);
  }

  @Get('cash-ledger')
  @Permissions('reports.view')
  getCashLedger(
    @Req() req: RequestWithUser,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getCashLedger(
      req.user,
      locationId ? Number(locationId) : undefined,
      startDate,
      endDate,
    );
  }

  @Get('day-sheet')
  @Permissions('reports.view')
  getDaySheet(
    @Req() req: RequestWithUser,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getDaySheet(
      req.user,
      locationId ? Number(locationId) : undefined,
      startDate,
      endDate,
    );
  }

  @Get('inventory-breakdown/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.view')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="inventory-breakdown.csv"')
  exportInventoryBreakdown(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.service.getInventoryBreakdownCsv(
      req.user,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('low-stock/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.view')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="low-stock.csv"')
  exportLowStock(
    @Req() req: RequestWithUser,
    @Query() query: StockReportQueryDto,
  ) {
    return this.service.getLowStockCsv(
      req.user,
      query.search,
      query.categoryId,
      query.locationId,
    );
  }

  @Get('dead-stock/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.view')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="dead-stock.csv"')
  exportDeadStock(
    @Req() req: RequestWithUser,
    @Query() query: StockReportQueryDto,
  ) {
    return this.service.getDeadStockCsv(
      req.user,
      query.search,
      query.categoryId,
      query.locationId,
    );
  }

  @Get('inventory-breakdown/pdf')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.view')
  async exportInventoryBreakdownPdf(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    const buffer = await this.service.getInventoryBreakdownPdf(
      req.user,
      query.locationId,
      query.categoryId,
      query.search,
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="inventory-breakdown.pdf"',
    });
  }

  @Get('low-stock/pdf')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.view')
  async exportLowStockPdf(
    @Req() req: RequestWithUser,
    @Query() query: StockReportQueryDto,
  ) {
    const buffer = await this.service.getLowStockPdf(
      req.user,
      query.search,
      query.categoryId,
      query.locationId,
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="low-stock.pdf"',
    });
  }

  @Get('dead-stock/pdf')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.view')
  async exportDeadStockPdf(
    @Req() req: RequestWithUser,
    @Query() query: StockReportQueryDto,
  ) {
    const buffer = await this.service.getDeadStockPdf(
      req.user,
      query.search,
      query.categoryId,
      query.locationId,
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="dead-stock.pdf"',
    });
  }

  @Get('sales-summary/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.full')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="sales-profit.csv"')
  exportSalesCsv(@Req() req: RequestWithUser, @Query() query: ReportQueryDto) {
    return this.service.getSalesCsv(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('sales-summary/pdf')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.full')
  async exportSalesPdf(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    const buffer = await this.service.getSalesPdf(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="sales-profit.pdf"',
    });
  }

  @Get('full/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.full')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="full-report.csv"')
  exportFullCsv(@Req() req: RequestWithUser, @Query() query: ReportQueryDto) {
    return this.service.getFullReportCsv(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
  }

  @Get('full/pdf')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Permissions('reports.full')
  async exportFullPdf(
    @Req() req: RequestWithUser,
    @Query() query: ReportQueryDto,
  ) {
    const buffer = await this.service.getFullReportPdf(
      req.user,
      query.startDate,
      query.endDate,
      query.locationId,
      query.categoryId,
      query.search,
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="full-report.pdf"',
    });
  }
}
