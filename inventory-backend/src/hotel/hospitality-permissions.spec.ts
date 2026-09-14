// src/hotel/hospitality-permissions.spec.ts
// Route-level contract for the hospitality permission model.
//
// The `@Permissions` metadata *is* the API's privilege surface, so these tests
// pin the exact key sets the pages were built against: front-desk actions accept
// `hotel.reception`, folio money accepts the folio keys, room configuration stays
// owner/manager-only, and housekeeping can flip cleanliness without gaining any
// billing power. A silent change here (e.g. widening check-in to `hotel.view`)
// would open a hole the frontend cannot compensate for.
import { PERMISSIONS_KEY } from '../common/decorators/permissions/permissions.decorator';
import { HotelController } from './hotel.controller';
import {
  FoliosController,
  GuestsController,
  PackagesController,
} from '../packages/packages.controller';
import { FacilitiesController } from '../facilities/facilities.controller';

/** Class-level keys (the default gate for every route in the controller). */
const classPerms = (ctor: any): string[] | undefined =>
  Reflect.getMetadata(PERMISSIONS_KEY, ctor);

/** Method-level keys (override the class gate when present). */
const methodPerms = (proto: any, method: string): string[] | undefined =>
  Reflect.getMetadata(PERMISSIONS_KEY, proto[method]);

describe('hotel controller permissions', () => {
  const proto = HotelController.prototype;

  it('reads the hotel module behind hotel.view', () => {
    expect(classPerms(HotelController)).toEqual(['hotel.view']);
    for (const read of [
      'listRoomTypes',
      'listRooms',
      'availableRooms',
      'listReservations',
      'getFolio',
      'listIdTypes',
    ]) {
      // No method decorator: the class gate (hotel.view) applies.
      expect(methodPerms(proto, read)).toBeUndefined();
    }
  });

  it('lets the front desk view the ID scan it captured', () => {
    expect(methodPerms(proto, 'getIdDocument')).toEqual([
      'hotel.view',
      'hotel.reception',
    ]);
  });

  it('shares the pre-checkout bill reads with the folio surface', () => {
    const bill = ['hotel.view', 'hotel.reception', 'folios.view'];
    expect(methodPerms(proto, 'checkoutPreview')).toEqual(bill);
    expect(methodPerms(proto, 'itemizedBill')).toEqual(bill);
  });

  it('keeps room, rate and ID-type configuration at hotel.manage', () => {
    for (const write of [
      'createRoomType',
      'updateRoomType',
      'deleteRoomType',
      'createRoom',
      'updateRoom',
      'deleteRoom',
      'deleteReservation',
      'createIdType',
      'updateIdType',
    ]) {
      expect(methodPerms(proto, write)).toEqual(['hotel.manage']);
    }
  });

  it('lets the front desk work reservations, check-in and id documents', () => {
    for (const frontDesk of [
      'createReservation',
      'updateReservation',
      'checkIn',
      'checkOut',
      'uploadIdDocument',
    ]) {
      expect(methodPerms(proto, frontDesk)).toEqual([
        'hotel.manage',
        'hotel.reception',
      ]);
    }
  });

  it('lets housekeeping flip room status without hotel.manage', () => {
    expect(methodPerms(proto, 'updateRoomStatus')).toEqual([
      'hotel.manage',
      'hotel.housekeeping.update',
    ]);
  });

  it('gates folio money on the folio keys', () => {
    const money = [
      'folios.settle',
      'folios.manage',
      'hotel.manage',
      'hotel.reception',
    ];
    expect(methodPerms(proto, 'checkout')).toEqual(money);
    expect(methodPerms(proto, 'settleFolio')).toEqual(money);
    expect(methodPerms(proto, 'addFolioEntry')).toEqual([
      'folios.charge',
      'folios.manage',
      'hotel.manage',
      'hotel.reception',
    ]);
  });

  it('keeps the POS charge-to-room lookup open to order takers', () => {
    expect(methodPerms(proto, 'chargeableRooms')).toEqual([
      'restaurant.take-orders',
      'restaurant.manage',
      'hotel.reception',
      'hotel.manage',
      'folios.charge',
      'folios.view',
    ]);
  });
});

describe('packages / guests / folios controller permissions', () => {
  it('lets waiters and the front desk bill package guests', () => {
    const lookup = methodPerms(PackagesController.prototype, 'lookup');
    expect(lookup).toEqual(
      expect.arrayContaining([
        'packages.view',
        'restaurant.take-orders',
        'restaurant.settle',
        'hotel.reception',
        'folios.charge',
      ]),
    );
    expect(methodPerms(PackagesController.prototype, 'remaining')).toEqual(
      lookup,
    );
  });

  it('leaves package definition to packages.manage', () => {
    for (const write of ['create', 'update', 'remove']) {
      expect(methodPerms(PackagesController.prototype, write)).toEqual([
        'packages.manage',
      ]);
    }
  });

  it('separates package check-in from settlement', () => {
    expect(classPerms(GuestsController)).toEqual(['folios.view']);
    expect(methodPerms(GuestsController.prototype, 'checkIn')).toEqual([
      'packages.manage',
      'packages.redeem',
      'hotel.reception',
    ]);
    expect(methodPerms(GuestsController.prototype, 'checkOut')).toEqual([
      'folios.settle',
      'folios.manage',
      'hotel.reception',
    ]);
    // Reading a guest ledger stays behind the class gate.
    expect(methodPerms(GuestsController.prototype, 'folio')).toBeUndefined();
  });

  it('exposes the shared itemized bill read behind folios.view', () => {
    expect(classPerms(FoliosController)).toEqual(['folios.view']);
  });
});

describe('facilities controller permissions', () => {
  it('separates day-pass check-in from facility configuration', () => {
    expect(classPerms(FacilitiesController)).toEqual(['facility.view']);
    for (const pass of ['checkIn', 'checkOut']) {
      expect(methodPerms(FacilitiesController.prototype, pass)).toEqual([
        'facility.check-in',
        'facility.manage',
      ]);
    }
    expect(
      methodPerms(FacilitiesController.prototype, 'searchMembers'),
    ).toEqual(['facility.view', 'memberships.view']);
    expect(
      methodPerms(FacilitiesController.prototype, 'getDashboard'),
    ).toBeUndefined();
  });
});
