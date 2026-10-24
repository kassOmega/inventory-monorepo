import { GuestOrderConversionService } from './guest-order-conversion.service';

describe('GuestOrderConversionService', () => {
  it('forwards the guest-selected unit and variant into the sale', async () => {
    const sales = {
      createSale: jest.fn(() => Promise.resolve({ id: 10 })),
    };
    const prisma = {
      guestOrder: { update: jest.fn(() => Promise.resolve({})) },
    };
    const service = new GuestOrderConversionService(
      prisma as any,
      {} as any,
      sales as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.convert(
      {
        id: 1,
        tenantId: 1,
        customerId: null,
        items: [
          {
            itemKind: 'PRODUCT',
            itemId: 5,
            variantId: 7,
            quantity: 3,
            unitId: 2,
            notes: null,
          },
        ],
      } as any,
      { sub: 1 } as any,
      { locationId: 3, saleType: 'FULLY_PAID', paymentMethodId: 1 },
    );

    expect(sales.createSale).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 3,
        items: [{ productId: 5, variantId: 7, quantity: 3, unitId: 2 }],
      }),
      expect.anything(),
    );
  });
});
