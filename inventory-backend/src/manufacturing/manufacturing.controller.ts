// src/manufacturing/manufacturing.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { BusinessType } from "@prisma/client";
import { Permissions } from "../common/decorators/permissions/permissions.decorator";
import { Vertical } from "../common/decorators/vertical.decorator";
import { RequestWithUser } from "../common/interfaces/request-with-user.interface";
import {
  CreateBomDto,
  CreateConsumableIssueDto,
  CreateDirectReceiptDto,
  CreateVendorCreditNoteDto,
  CreateGoodsReceiptDto,
  GenerateVendorBillDto,
  CreateManufacturingOrderDto,
  CreateMaterialIssueDto,
  CreateMfgFlowDto,
  CreateMfgServiceDto,
  CreateMfgTeamDto,
  CreatePurchaseOrderDto,
  CreateMachineDto,
  CreateShiftSessionDto,
  CreateShiftFromTemplateDto,
  IssueMachineDto,
  ReturnMachineIssuanceDto,
  ReorderMfgTeamsDto,
  AssignOrderFlowDto,
  AdvanceOrderDto,
  CompleteOrderDeliveryDto,
  CreateShiftTemplateDto,
  CreateVendorDto,
  CreateDesignCategoryDto,
  UpdateDesignCategoryDto,
  CreateDesignCatalogItemDto,
  UpdateDesignCatalogItemDto,
  CreateWorkOrderDto,
  LogScrapDto,
  MachineComponentDto,
  RecordConsumableUsageDto,
  RecordMfgServiceIncomeDto,
  ReturnMaterialDto,
  AssignShiftWorkersDto,
  UpdateBomDto,
  UpdateMfgFlowDto,
  UpdateManufacturingOrderDto,
  UpdateMachineComponentStatusDto,
  UpdateMachineStatusDto,
  UpdateMachineDto,
  UpdateMfgServiceDto,
  UpdateMfgTeamDto,
  UpdatePurchaseOrderDto,
  UpdateVendorDto,
  CreateWorkerDto,
  UpdateWorkerStatusDto,
  PayVendorBillDto,
  UpdateManufacturingOrderStageDto,
  UpdateWorkOrderStatusDto,
} from "./dto/manufacturing.dto";
import { ManufacturingService } from "./manufacturing.service";

@Controller("manufacturing")
@Vertical(BusinessType.MANUFACTURING)
export class ManufacturingController {
  constructor(private readonly mfg: ManufacturingService) {}

  // --------------------------------------------------------------------
  // Bills of materials
  // --------------------------------------------------------------------

  @Get("boms")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listBoms(
    @Query("finishedProductId") finishedProductId?: string,
    @Query("search") search?: string,
  ) {
    return this.mfg.listBoms({
      finishedProductId: finishedProductId ? Number(finishedProductId) : undefined,
      search,
    });
  }

  @Post("boms")
  @Permissions("manufacturing.manage")
  createBom(@Body() dto: CreateBomDto) {
    return this.mfg.createBom(dto);
  }

  @Get("boms/:id")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getBom(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.getBom(id);
  }

  @Patch("boms/:id")
  @Permissions("manufacturing.manage")
  updateBom(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateBomDto) {
    return this.mfg.updateBom(id, dto);
  }

  @Delete("boms/:id")
  @Permissions("manufacturing.manage")
  deleteBom(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteBom(id);
  }


  // --------------------------------------------------------------------
  // Work orders
  // --------------------------------------------------------------------

  @Get("work-orders")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listWorkOrders(
    @Query("status") status?: string,
    @Query("locationId") locationId?: string,
    @Query("productId") productId?: string,
  ) {
    return this.mfg.listWorkOrders({
      status,
      locationId: locationId ? Number(locationId) : undefined,
      finishedProductId: productId ? Number(productId) : undefined,
    });
  }

  @Post("work-orders")
  @Permissions("manufacturing.manage")
  createWorkOrder(@Body() dto: CreateWorkOrderDto, @Req() req: RequestWithUser) {
    return this.mfg.createWorkOrder(dto, req.user);
  }

  @Get("work-orders/:id")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getWorkOrder(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.getWorkOrder(id);
  }

  @Patch("work-orders/:id/status")
  @Permissions("manufacturing.manage")
  updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateWorkOrderStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.updateStatus(id, dto, req.user);
  }

  @Post("work-orders/:id/scrap")
  @Permissions("manufacturing.manage")
  logScrap(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: LogScrapDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.logScrap(id, dto, req.user);
  }

  // --------------------------------------------------------------------
  // Add-on services & recorded service income
  // --------------------------------------------------------------------

  @Get("services")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listServices(@Query("active") active?: string) {
    return this.mfg.listMfgServices(active === "1" || active === "true");
  }

  @Post("services")
  @Permissions("manufacturing.manage")
  createService(@Body() dto: CreateMfgServiceDto) {
    return this.mfg.createMfgService(dto);
  }

  @Patch("services/:id")
  @Permissions("manufacturing.manage")
  updateService(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMfgServiceDto) {
    return this.mfg.updateMfgService(id, dto);
  }

  @Delete("services/:id")
  @Permissions("manufacturing.manage")
  deleteService(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteMfgService(id);
  }

  @Get("service-incomes")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listServiceIncomes(
    @Query("serviceId") serviceId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.mfg.listMfgServiceIncomes({
      serviceId: serviceId ? Number(serviceId) : undefined,
      startDate,
      endDate,
    });
  }

  @Post("service-incomes")
  @Permissions("manufacturing.view", "manufacturing.manage")
  recordServiceIncome(@Body() dto: RecordMfgServiceIncomeDto, @Req() req: RequestWithUser) {
    return this.mfg.recordMfgServiceIncome(dto, req.user);
  }

  // --------------------------------------------------------------------
  // Manufacturing job orders (customer-facing pipeline)
  // --------------------------------------------------------------------

  @Get("jobs")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listJobs(@Query("stage") stage?: string, @Query("search") search?: string) {
    return this.mfg.listJobs({ stage, search });
  }

  @Post("jobs")
  @Permissions("manufacturing.manage")
  createJob(@Body() dto: CreateManufacturingOrderDto, @Req() req: RequestWithUser) {
    return this.mfg.createJob(dto, req.user);
  }

  @Get("jobs/:id")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getJob(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.getJob(id);
  }

  @Patch("jobs/:id/stage")
  @Permissions("manufacturing.manage")
  updateJobStage(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateManufacturingOrderStageDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.updateJobStage(id, dto, req.user);
  }

  @Patch("jobs/:id")
  @Permissions("manufacturing.manage")
  updateJob(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateManufacturingOrderDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.updateJob(id, dto, req.user);
  }

  @Delete("jobs/:id")
  @Permissions("manufacturing.manage")
  deleteJob(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.deleteJob(id, req.user);
  }

  // --------------------------------------------------------------------
  // Design Catalog (customer-facing product/design registry)
  // --------------------------------------------------------------------

  @Get("catalog/categories")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listDesignCategories() {
    return this.mfg.listDesignCategories();
  }

  @Post("catalog/categories")
  @Permissions("manufacturing.manage")
  createDesignCategory(
    @Body() dto: CreateDesignCategoryDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.createDesignCategory(dto, req.user);
  }

  @Patch("catalog/categories/:id")
  @Permissions("manufacturing.manage")
  updateDesignCategory(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateDesignCategoryDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.updateDesignCategory(id, dto, req.user);
  }

  @Delete("catalog/categories/:id")
  @Permissions("manufacturing.manage")
  deleteDesignCategory(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.deleteDesignCategory(id, req.user);
  }

  @Get("catalog/items")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listDesignCatalogItems(
    @Query("categoryId") categoryId?: string,
    @Query("search") search?: string,
  ) {
    return this.mfg.listDesignCatalogItems({
      categoryId: categoryId ? Number(categoryId) : undefined,
      search,
    });
  }

  @Post("catalog/items")
  @Permissions("manufacturing.manage")
  createDesignCatalogItem(
    @Body() dto: CreateDesignCatalogItemDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.createDesignCatalogItem(dto, req.user);
  }

  @Patch("catalog/items/:id")
  @Permissions("manufacturing.manage")
  updateDesignCatalogItem(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateDesignCatalogItemDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.updateDesignCatalogItem(id, dto, req.user);
  }

  @Delete("catalog/items/:id")
  @Permissions("manufacturing.manage")
  deleteDesignCatalogItem(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.deleteDesignCatalogItem(id, req.user);
  }

  // --------------------------------------------------------------------
  // Materials: issue to worker & return
  // --------------------------------------------------------------------

  @Post("issues")
  @Permissions("manufacturing.manage")
  issueMaterial(@Body() dto: CreateMaterialIssueDto, @Req() req: RequestWithUser) {
    return this.mfg.issueMaterial(dto, req.user);
  }

  @Get("issues")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listIssues(
    @Query("workOrderId") workOrderId?: string,
    @Query("jobId") jobId?: string,
    @Query("issuedToId") issuedToId?: string,
    @Query("status") status?: string,
  ) {
    return this.mfg.listMaterialIssues({
      workOrderId: workOrderId ? Number(workOrderId) : undefined,
      jobId: jobId ? Number(jobId) : undefined,
      issuedToId: issuedToId ? Number(issuedToId) : undefined,
      status,
    });
  }

  @Get("issues/variance")
  @Permissions("manufacturing.view", "manufacturing.manage")
  materialVariance(@Query("workOrderId") workOrderId?: string, @Query("jobId") jobId?: string) {
    return this.mfg.materialVariance({
      workOrderId: workOrderId ? Number(workOrderId) : undefined,
      jobId: jobId ? Number(jobId) : undefined,
    });
  }

  @Post("returns")
  @Permissions("manufacturing.manage")
  returnMaterial(@Body() dto: ReturnMaterialDto, @Req() req: RequestWithUser) {
    return this.mfg.returnMaterial(dto, req.user);
  }

  // --------------------------------------------------------------------
  // Machines & components
  // --------------------------------------------------------------------

  @Get("machines")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listMachines() {
    return this.mfg.listMachines();
  }

  @Post("machines")
  @Permissions("manufacturing.manage")
  createMachine(@Body() dto: CreateMachineDto) {
    return this.mfg.createMachine(dto);
  }

  @Patch("machines/:id/status")
  @Permissions("manufacturing.manage")
  updateMachineStatus(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMachineStatusDto, @Req() req: RequestWithUser) {
    return this.mfg.updateMachineStatus(id, dto, req.user);
  }

  @Patch("machines/:id")
  @Permissions("manufacturing.manage")
  updateMachine(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMachineDto) {
    return this.mfg.updateMachine(id, dto);
  }

  @Delete("machines/:id")
  @Permissions("manufacturing.manage")
  deleteMachine(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteMachine(id);
  }

  @Post("machines/:id/components")
  @Permissions("manufacturing.manage")
  addMachineComponent(@Param("id", ParseIntPipe) id: number, @Body() dto: MachineComponentDto) {
    return this.mfg.addMachineComponent(id, dto);
  }

  @Patch("machines/components/:componentId/status")
  @Permissions("manufacturing.manage")
  updateComponentStatus(@Param("componentId", ParseIntPipe) componentId: number, @Body() dto: UpdateMachineComponentStatusDto, @Req() req: RequestWithUser) {
    return this.mfg.updateComponentStatus(componentId, dto, req.user);
  }

  // --------------------------------------------------------------------
  // Consumables
  // --------------------------------------------------------------------

  @Get("machine-issuances")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listMachineIssuances(@Query("status") status?: string) {
    return this.mfg.listMachineIssuances({ status });
  }

  @Post("machine-issuances")
  @Permissions("manufacturing.manage")
  issueMachine(@Body() dto: IssueMachineDto, @Req() req: RequestWithUser) {
    return this.mfg.issueMachine(dto, req.user);
  }

  @Post("machine-issuances/:id/return")
  @Permissions("manufacturing.manage")
  returnMachineIssuance(@Param("id", ParseIntPipe) id: number, @Body() dto: ReturnMachineIssuanceDto, @Req() req: RequestWithUser) {
    return this.mfg.returnMachineIssuance(id, dto, req.user);
  }

  @Get("order-flow")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getOrderFlow() {
    return this.mfg.getOrderFlow();
  }

  // Teams & flows the order pipeline is routed through (owner-managed).

  @Get("teams")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listTeams() {
    return this.mfg.listTeams();
  }

  @Post("teams")
  @Permissions("manufacturing.manage")
  createTeam(@Body() dto: CreateMfgTeamDto) {
    return this.mfg.createTeam(dto);
  }

  @Patch("teams/reorder")
  @Permissions("manufacturing.manage")
  reorderTeams(@Body() dto: ReorderMfgTeamsDto) {
    return this.mfg.reorderTeams(dto);
  }

  @Patch("teams/:id")
  @Permissions("manufacturing.manage")
  updateTeam(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMfgTeamDto) {
    return this.mfg.updateTeam(id, dto);
  }

  @Delete("teams/:id")
  @Permissions("manufacturing.manage")
  deleteTeam(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteTeam(id);
  }

  @Get("flows")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listFlows() {
    return this.mfg.listFlows();
  }

  @Post("flows")
  @Permissions("manufacturing.manage")
  createFlow(@Body() dto: CreateMfgFlowDto) {
    return this.mfg.createFlow(dto);
  }

  @Patch("flows/:id")
  @Permissions("manufacturing.manage")
  updateFlow(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMfgFlowDto) {
    return this.mfg.updateFlow(id, dto);
  }

  @Post("flows/:id/default")
  @Permissions("manufacturing.manage")
  setDefaultFlow(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.setDefaultFlow(id);
  }

  @Delete("flows/:id")
  @Permissions("manufacturing.manage")
  deleteFlow(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteFlow(id);
  }

  @Get("orders/queue")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getOrderQueue(@Query("teamId") teamId?: string) {
    return this.mfg.getOrderQueue(teamId ? Number(teamId) : undefined);
  }

  @Post("orders/:id/assign-flow")
  @Permissions("manufacturing.manage")
  assignOrderFlow(@Param("id", ParseIntPipe) id: number, @Body() dto: AssignOrderFlowDto, @Req() req: RequestWithUser) {
    return this.mfg.assignOrderFlow(id, dto, req.user);
  }

  @Post("orders/:id/advance")
  @Permissions("manufacturing.manage")
  advanceOrder(@Param("id", ParseIntPipe) id: number, @Body() dto: AdvanceOrderDto, @Req() req: RequestWithUser) {
    return this.mfg.advanceOrder(id, dto, req.user);
  }

  @Post("orders/:id/complete-delivery")
  @Permissions("manufacturing.manage")
  completeOrderDelivery(@Param("id", ParseIntPipe) id: number, @Body() dto: CompleteOrderDeliveryDto, @Req() req: RequestWithUser) {
    return this.mfg.completeOrderDelivery(id, dto, req.user);
  }

  @Get("workers")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getWorkers() {
    return this.mfg.getWorkers();
  }

  @Post("workers")
  @Permissions("manufacturing.manage")
  createWorker(@Body() dto: CreateWorkerDto) {
    return this.mfg.createWorker(dto);
  }

  @Patch("workers/:id/status")
  @Permissions("manufacturing.manage")
  updateWorkerStatus(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateWorkerStatusDto) {
    return this.mfg.updateWorkerStatus(id, dto);
  }

  @Post("consumable-issues")
  @Permissions("manufacturing.manage")
  createConsumableIssue(@Body() dto: CreateConsumableIssueDto) {
    return this.mfg.createConsumableIssue(dto);
  }

  @Post("consumable-usage")
  @Permissions("manufacturing.manage")
  recordConsumableUsage(@Body() dto: RecordConsumableUsageDto) {
    return this.mfg.recordConsumableUsage(dto);
  }

  @Get("consumable-activity")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listConsumableActivity() {
    return this.mfg.listConsumableActivity();
  }

  // --------------------------------------------------------------------
  // Shifts
  // --------------------------------------------------------------------

  @Get("shift-templates")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listShiftTemplates() {
    return this.mfg.listShiftTemplates();
  }

  @Post("shift-templates")
  @Permissions("manufacturing.manage")
  createShiftTemplate(@Body() dto: CreateShiftTemplateDto) {
    return this.mfg.createShiftTemplate(dto);
  }

  @Patch("shift-templates/:id")
  @Permissions("manufacturing.manage")
  updateShiftTemplate(@Param("id", ParseIntPipe) id: number, @Body() dto: CreateShiftTemplateDto) {
    return this.mfg.updateShiftTemplate(id, dto);
  }

  @Get("shift-sessions")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listShiftSessions(@Query("status") status?: string, @Query("date") date?: string) {
    return this.mfg.listShiftSessions({ status, date });
  }

  @Post("shift-sessions/from-template")
  @Permissions("manufacturing.manage")
  createShiftFromTemplate(@Body() dto: CreateShiftFromTemplateDto) {
    return this.mfg.createShiftFromTemplate(dto);
  }

  @Post("shift-sessions")
  @Permissions("manufacturing.manage")
  createShiftSession(@Body() dto: CreateShiftSessionDto) {
    return this.mfg.createShiftSession(dto);
  }

  @Post("shift-sessions/:id/start")
  @Permissions("manufacturing.manage")
  startShiftSession(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.startShiftSession(id);
  }

  @Post("shift-sessions/:id/end")
  @Permissions("manufacturing.manage")
  endShiftSession(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.endShiftSession(id);
  }

  @Post("shift-sessions/:id/workers")
  @Permissions("manufacturing.manage")
  assignShiftWorkers(@Param("id", ParseIntPipe) id: number, @Body() dto: AssignShiftWorkersDto) {
    return this.mfg.assignShiftWorkers(id, dto);
  }

  // --- Raw-material purchasing: vendors, purchase orders & goods receipts -----

  @Get("vendors")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listVendors(@Query("search") search?: string) {
    return this.mfg.listVendors(search);
  }

  @Post("vendors")
  @Permissions("manufacturing.manage")
  createVendor(@Body() dto: CreateVendorDto) {
    return this.mfg.createVendor(dto);
  }

  @Patch("vendors/:id")
  @Permissions("manufacturing.manage")
  updateVendor(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateVendorDto) {
    return this.mfg.updateVendor(id, dto);
  }

  @Delete("vendors/:id")
  @Permissions("manufacturing.manage")
  deleteVendor(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteVendor(id);
  }

  @Get("purchase-orders/material-products")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listMaterialProducts() {
    return this.mfg.listMaterialProducts();
  }

  @Get("purchase-orders/netting-shortage")
  @Permissions("manufacturing.view", "manufacturing.manage")
  purchaseOrderNetting() {
    return this.mfg.purchaseOrderNetting();
  }

  @Get("purchase-orders")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listPurchaseOrders(
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("vendorId") vendorId?: string,
  ) {
    return this.mfg.listPurchaseOrders({
      status,
      search,
      vendorId: vendorId ? Number(vendorId) : undefined,
    });
  }

  @Get("purchase-orders/backorders")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listBackorders() {
    return this.mfg.listOpenPurchaseOrderLines();
  }

  @Get("purchase-orders/:id")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getPurchaseOrder(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.getPurchaseOrder(id);
  }

  @Post("purchase-orders")
  @Permissions("manufacturing.manage")
  createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto, @Req() req: RequestWithUser) {
    return this.mfg.createPurchaseOrder(dto, req.user);
  }

  @Patch("purchase-orders/:id")
  @Permissions("manufacturing.manage")
  updatePurchaseOrder(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdatePurchaseOrderDto) {
    return this.mfg.updatePurchaseOrder(id, dto);
  }

  @Post("purchase-orders/:id/send")
  @Permissions("manufacturing.manage")
  sendPurchaseOrder(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.sendPurchaseOrder(id, req.user);
  }

  @Post("purchase-orders/:id/cancel")
  @Permissions("manufacturing.manage")
  cancelPurchaseOrder(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.cancelPurchaseOrder(id, req.user);
  }

  @Delete("purchase-orders/:id")
  @Permissions("manufacturing.manage")
  deletePurchaseOrder(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deletePurchaseOrder(id);
  }

  @Get("goods-receipts")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listGoodsReceipts(
    @Query("search") search?: string,
    @Query("purchaseOrderId") purchaseOrderId?: string,
  ) {
    return this.mfg.listGoodsReceipts({
      search,
      purchaseOrderId: purchaseOrderId ? Number(purchaseOrderId) : undefined,
    });
  }

  @Get("goods-receipts/:id")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getGoodsReceipt(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.getGoodsReceipt(id);
  }

  @Post("goods-receipts")
  @Permissions("manufacturing.manage")
  createGoodsReceipt(@Body() dto: CreateGoodsReceiptDto, @Req() req: RequestWithUser) {
    return this.mfg.receiveGoods(dto, req.user);
  }

  @Post("goods-receipts/direct")
  @Permissions("manufacturing.manage")
  createDirectReceipt(@Body() dto: CreateDirectReceiptDto, @Req() req: RequestWithUser) {
    return this.mfg.receiveDirectGoods(dto, req.user);
  }

  @Get("vendor-bills")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listVendorBills() {
    return this.mfg.listVendorBills();
  }

  @Get("vendor-bills/:id")
  @Permissions("manufacturing.view", "manufacturing.manage")
  getVendorBill(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.getVendorBill(id);
  }

  @Post("vendor-bills/from-grn")
  @Permissions("manufacturing.manage")
  createVendorBillFromGrn(@Body() dto: GenerateVendorBillDto, @Req() req: RequestWithUser) {
    return this.mfg.createVendorBillFromGrn(dto, req.user);
  }

  @Post("vendor-bills/:id/approve")
  @Permissions("manufacturing.manage")
  approveVendorBill(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.approveVendorBill(id, req.user);
  }

  @Post("vendor-bills/:id/pay")
  @Permissions("manufacturing.manage")
  payVendorBill(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: PayVendorBillDto,
    @Req() req: RequestWithUser,
  ) {
    return this.mfg.payVendorBill(id, dto, req.user);
  }

  @Delete("vendor-bills/:id")
  @Permissions("manufacturing.manage")
  deleteVendorBill(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteVendorBill(id);
  }

  @Get("rejected-stock")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listRejectedStock(@Query("disposition") disposition?: string) {
    return this.mfg.listRejectedStock({ disposition });
  }

  @Post("rejected-stock/:id/scrap")
  @Permissions("manufacturing.manage")
  scrapRejectedStock(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.scrapRejectedStock(id, req.user);
  }

  @Get("vendor-credit-notes")
  @Permissions("manufacturing.view", "manufacturing.manage")
  listVendorCreditNotes() {
    return this.mfg.listVendorCreditNotes();
  }

  @Post("vendor-credit-notes")
  @Permissions("manufacturing.manage")
  createVendorCreditNote(@Body() dto: CreateVendorCreditNoteDto, @Req() req: RequestWithUser) {
    return this.mfg.createVendorCreditNote(dto, req.user);
  }

  @Post("vendor-credit-notes/:id/issue")
  @Permissions("manufacturing.manage")
  issueVendorCreditNote(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.issueVendorCreditNote(id, req.user);
  }

  @Post("vendor-credit-notes/:id/apply")
  @Permissions("manufacturing.manage")
  applyVendorCreditNote(@Param("id", ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.mfg.applyVendorCreditNote(id, req.user);
  }

  @Delete("vendor-credit-notes/:id")
  @Permissions("manufacturing.manage")
  deleteVendorCreditNote(@Param("id", ParseIntPipe) id: number) {
    return this.mfg.deleteVendorCreditNote(id);
  }
}