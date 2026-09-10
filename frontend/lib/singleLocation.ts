import { useEffect } from "react";

export type LocationOption = { id: number | string; name: string };

/**
 * When a retailer's active business has exactly ONE location, return its id
 * (as a string) so it can be autofilled in location/store/shop pickers.
 * Returns "" when there are zero or multiple locations.
 */
export function getSingleLocationId(locations: LocationOption[]): string {
  if (locations.length === 1) return String(locations[0].id);
  return "";
}

/**
 * Autofill a location/store/shop select with the sole location once the
 * locations load — but only when the current value is still empty, so an
 * owner's explicit choice is never overwritten.
 *
 * Usage (in a retailer page that asks for a location):
 *   useSingleLocationAutofill(locations, currentValue, setValue);
 */
export function useSingleLocationAutofill(
  locations: LocationOption[],
  currentValue: string,
  setValue: (v: string) => void,
) {
  useEffect(() => {
    if (locations.length !== 1) return;
    const only = String(locations[0].id);
    if (!currentValue) setValue(only);
  }, [locations, currentValue, setValue]);
}
