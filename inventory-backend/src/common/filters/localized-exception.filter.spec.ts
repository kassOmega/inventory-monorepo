import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocalizedExceptionFilter } from './localized-exception.filter';

const hostWith = (res: any) =>
  ({
    switchToHttp: () => ({ getResponse: () => res }),
  }) as any;

const capture = () => {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: any) {
      captured.body = body;
      return this;
    },
  };
  return { res, captured };
};

describe('LocalizedExceptionFilter', () => {
  const filter = new LocalizedExceptionFilter();

  it('returns the status, message and error for a plain exception', () => {
    const { res, captured } = capture();

    filter.catch(new NotFoundException('Product not found'), hostWith(res));

    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({
      statusCode: 404,
      message: 'Product not found',
      error: 'Not Found',
    });
  });

  it('keeps structured detail thrown alongside the message', () => {
    const { res, captured } = capture();

    filter.catch(
      new BadRequestException({
        message: 'Some rows could not be processed',
        errors: [
          {
            index: 1,
            productId: 9,
            variantId: null,
            locationId: 999,
            message: 'Location not found',
          },
        ],
      }),
      hostWith(res),
    );

    // The body of a rejected count sheet: the sheet UI highlights each bad row
    // from this array, so the filter must not drop it.
    expect(captured.status).toBe(400);
    expect(captured.body.message).toBe('Some rows could not be processed');
    expect(captured.body.errors).toEqual([
      {
        index: 1,
        productId: 9,
        variantId: null,
        locationId: 999,
        message: 'Location not found',
      },
    ]);
  });

  it('keeps error codes and amounts the client branches on', () => {
    const { res, captured } = capture();

    filter.catch(
      new BadRequestException({
        message: 'Collected 100 but only 80 is outstanding',
        code: 'OVERPAYMENT',
        totalDue: 80,
        paidTotal: 100,
      }),
      hostWith(res),
    );

    expect(captured.body).toMatchObject({
      statusCode: 400,
      code: 'OVERPAYMENT',
      totalDue: 80,
      paidTotal: 100,
    });
  });

  it('never lets thrown extras overwrite the status or message', () => {
    const { res, captured } = capture();

    filter.catch(
      new BadRequestException({
        message: 'Nope',
        statusCode: 999,
        error: 'Weird',
      }),
      hostWith(res),
    );

    expect(captured.body.statusCode).toBe(400);
    expect(captured.body.message).toBe('Nope');
    expect(captured.body.error).toBe('Weird');
  });

  it('turns a non-HTTP exception into a 500 with its own message', () => {
    const { res, captured } = capture();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), hostWith(res));

    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({ statusCode: 500, message: 'boom' });
    spy.mockRestore();
  });
});
