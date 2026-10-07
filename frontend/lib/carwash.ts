// Shared car-wash constants.
// Vehicle types AND wash types are now business-defined entities
// (see CarWashVehicleType / CarWashWashType). This list is the default seed
// set (see prisma/backfill-carwash-vehicle-types.ts) and is kept for reference
// only.
export const DEFAULT_VEHICLE_TYPES = [
  "Car",
  "SUV",
  "Pickup",
  "Van",
  "Truck",
  "Bus",
  "Motorcycle",
  "Tricycle",
  "Other",
];
