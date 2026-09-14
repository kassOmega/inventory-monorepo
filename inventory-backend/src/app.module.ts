import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { I18nModule } from './i18n/i18n.module';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { CashModule } from './cash/cash.module';
import { CategoriesModule } from './categories/categories.module';
import { JwtAuthGuard } from './common/guards/jwt-auth/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions/permissions.guard';
import { TenantGuard } from './common/guards/tenant/tenant.guard';
import { VerificationGuard } from './common/guards/verification/verification.guard';
import { VerticalGuard } from './common/guards/vertical/vertical.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { LocalizedResponseInterceptor } from './common/interceptors/localized-response.interceptor';
import { CsrfGuard } from './common/guards/csrf/csrf.guard';
import { CreditPaymentsModule } from './credit-payments/credit-payments.module';
import { CreditSalesModule } from './credit-sales/credit-sales.module';
import { CustomersModule } from './customers/customers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { LocationsModule } from './locations/locations.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PriceHistoryModule } from './price-history/price-history.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { PushModule } from './push/push.module';
import { ReportsModule } from './reports/reports.module';
import { TasksModule } from './tasks/tasks.module';
import { TenantsModule } from './tenants/tenants.module';
import { FinanceModule } from './finance/finance.module';
import { HotelModule } from './hotel/hotel.module';
import { FacilitiesModule } from './facilities/facilities.module';
import { InventoryModule } from './inventory/inventory.module';
import { MembershipsModule } from './memberships/memberships.module';
import { PackagesModule } from './packages/packages.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { RequestsModule } from './requests/requests.module';
import { RestockModule } from './restock/restock.module';
import { RolesModule } from './roles/roles.module';
import { SalesModule } from './sales/sales.module';
import { ServiceModule } from './service/service.module';
import { UnitsModule } from './units/units.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';
import { VerticalProfilesModule } from './vertical-profiles/vertical-profiles.module';
import { TaxesModule } from './taxes/taxes.module';
import { FiscalModule } from './fiscal/fiscal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    I18nModule,
    AdminModule,
    AgentModule,
    AiModule,
    AuthModule,
    CashModule,
    CategoriesModule,
    LocationsModule,
    ProductsModule,
    RequestsModule,
    SalesModule,
    ReportsModule,
    UsersModule,
    RolesModule,
    PriceHistoryModule,
    RestockModule,
    NotificationsModule,
    PaymentMethodsModule,
    PurchasesModule,
    CustomersModule,
    CreditSalesModule,
    CreditPaymentsModule,
    UnitsModule,
    PushModule,
    TasksModule,
    TenantsModule,
    FinanceModule,
    RestaurantModule,
    HotelModule,
    FacilitiesModule,
    InventoryModule,
    MembershipsModule,
    PackagesModule,
    VerificationModule,
    VerticalProfilesModule,
    ServiceModule,
    ManufacturingModule,
    TaxesModule,
    FiscalModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: VerificationGuard },
    { provide: APP_GUARD, useClass: VerticalGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LocalizedResponseInterceptor },
  ],
})
export class AppModule {}
