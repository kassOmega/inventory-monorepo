// src/public/public.controller.ts
// PUBLIC (unauthenticated) guest-ordering endpoints. Every route is scoped ONLY
// by the opaque entry token in the path/body — there are no internal :id params,
// and no X-Tenant-Id is ever trusted here.
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PublicService } from './public.service';

@Controller('public')
@Public()
export class PublicController {
  constructor(private readonly publicSvc: PublicService) {}

  /** The public-safe view + catalog for a scanned QR token. */
  @Get('entry/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  entry(@Param('token') token: string) {
    return this.publicSvc.view(token);
  }

  /** Autofill the guest's name from their phone (minimal, tenant-scoped by token). */
  @Post('entry/:token/customer-lookup')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  lookup(@Param('token') token: string, @Body('phone') phone: string) {
    return this.publicSvc.lookupCustomer(token, phone);
  }

  /** Submit a guest order/booking. */
  @Post('entry/:token/orders')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  submit(
    @Param('token') token: string,
    @Body()
    body: {
      items: Array<{
        ref: string;
        quantity: number;
        unitId?: number;
        notes?: string;
      }>;
      customerName?: string;
      customerPhone?: string;
      tableNumber?: string;
      identityMode?: 'TABLE' | 'PHONE';
      note?: string;
    },
  ) {
    return this.publicSvc.submit(token, body);
  }

  /** Submit a public room reservation (no auth, scoped by the entry token). */
  @Post('entry/:token/reservations')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  reserve(
    @Param('token') token: string,
    @Body()
    body: {
      roomTypeRef?: string;
      checkIn?: string;
      checkOut?: string;
      guestName?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    return this.publicSvc.reserve(token, body);
  }

  /** Public room availability for the guest-chosen stay window. */
  @Get('entry/:token/room-availability')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  roomAvailability(
    @Param('token') token: string,
    @Query('checkIn') checkIn?: string,
    @Query('checkOut') checkOut?: string,
  ) {
    return this.publicSvc.roomAvailability(token, checkIn, checkOut);
  }

  /** Submit a public service booking (no auth, scoped by the entry token). */
  @Post('entry/:token/service-bookings')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  serviceBooking(
    @Param('token') token: string,
    @Body()
    body: {
      serviceItemRef?: string;
      startsAt?: string;
      guestName?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    return this.publicSvc.serviceBooking(token, body);
  }

  /** The guest's own order status (by its opaque order token). */
  @Get('orders/:orderToken')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  status(@Param('orderToken') orderToken: string) {
    return this.publicSvc.orderStatus(orderToken);
  }

  /** Public-safe car-wash booking options (wash types, prices, washers, slots). */
  @Get('entry/:token/carwash-options')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  carwashOptions(@Param('token') token: string) {
    return this.publicSvc.carwashOptions(token);
  }

  /** Check a washer's availability for a slot (scoped by the entry token). */
  @Get('entry/:token/carwash-availability')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  carwashAvailability(
    @Param('token') token: string,
    @Query('washerId') washerId: string,
    @Query('startsAt') startsAt: string,
    @Query('slotMinutes') slotMinutes?: string,
    @Query('vehicleType') vehicleType?: string,
    @Query('washTypeId') washTypeId?: string,
  ) {
    return this.publicSvc.carwashAvailability(
      token,
      Number(washerId),
      startsAt,
      slotMinutes ? Number(slotMinutes) : undefined,
      vehicleType,
      washTypeId ? Number(washTypeId) : undefined,
    );
  }

  /** Submit a public car-wash booking (no auth, scoped by the entry token). */
  @Post('entry/:token/carwash-bookings')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  carwashBooking(
    @Param('token') token: string,
    @Body()
    body: {
      name?: string;
      phone?: string;
      plateNumber?: string;
      vehicleType?: string;
      washTypeId?: number;
      washerId?: number;
      startsAt?: string;
      notes?: string;
      items?: Array<{
        vehicleType?: string;
        washTypeId?: number;
        plateNumber?: string;
        amount?: number;
      }>;
    },
  ) {
    return this.publicSvc.carwashBooking(token, body);
  }
}
