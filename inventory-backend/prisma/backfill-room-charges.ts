// prisma/backfill-room-charges.ts
// Idempotent data backfill for the room-rate posting rule.
//
// Before the hotel PMS refactor the room rate was never written to any ledger,
// so a stay's folio showed only POS charge-to-room lines and manual add-ons and
// the room revenue never reached the GL. Check-in now upserts exactly one
// ACCOMMODATION line per stay; this script posts it for stays that are already
// in-house so the open folios match the new behaviour.
//
// Scope: reservations currently CHECKED_IN whose folio has no ACCOMMODATION line.
// Safe to re-run: the guard is the same one check-in uses (one room line only),
// and settled/closed stays are left untouched.
//
// Usage:  npx ts-node prisma/backfill-room-charges.ts
import { HotelReservationStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const reservations = await prisma.hotelReservation.findMany({
    where: { status: HotelReservationStatus.CHECKED_IN },
    include: {
      room: { select: { number: true } },
      folios: {
        include: {
          entries: { select: { id: true, sourceService: true, type: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  let posted = 0;
  let skipped = 0;
  for (const reservation of reservations) {
    const folio = reservation.folios[0];
    const alreadyPosted = (folio?.entries ?? []).some(
      (e) => e.type === 'CHARGE' && e.sourceService === 'ACCOMMODATION',
    );
    if (alreadyPosted) {
      skipped += 1;
      continue;
    }
    if (reservation.totalAmount <= 0) {
      skipped += 1;
      console.log(
        `• Reservation #${reservation.id} (${reservation.guestName}) has no room charge (totalAmount 0) — skipped.`,
      );
      continue;
    }

    const nights = Math.max(
      1,
      Math.round(
        (reservation.checkOut.getTime() - reservation.checkIn.getTime()) /
          MS_PER_DAY,
      ),
    );
    const unitPrice = round2(reservation.totalAmount / nights);
    const description = `Room ${reservation.room?.number ?? '—'} — ${nights} night${
      nights === 1 ? '' : 's'
    } × ${unitPrice.toLocaleString()}`;

    // Create the stay folio if the stay somehow has none (older records).
    const targetFolio =
      folio ??
      (await prisma.folio.create({
        data: {
          tenantId: reservation.tenantId,
          reservationId: reservation.id,
          guestName: reservation.guestName,
        },
      }));

    await prisma.folioEntry.create({
      data: {
        tenantId: reservation.tenantId,
        folioId: targetFolio.id,
        description,
        amount: reservation.totalAmount,
        unitPrice,
        type: 'CHARGE',
        sourceService: 'ACCOMMODATION',
        createdById: reservation.checkedInById ?? null,
      },
    });
    posted += 1;
    console.log(
      `✅ Reservation #${reservation.id} (${reservation.guestName}) — posted ${description} = ${reservation.totalAmount}.`,
    );
  }

  console.log(
    `\nDone. ${posted} room charge(s) posted, ${skipped} stay(s) skipped (already posted or zero-rated).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
