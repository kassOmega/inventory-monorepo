"use client";

import FinanceComparison from "./FinanceComparison";
import FinancialBreakdown from "./FinancialBreakdown";
import ItemizedPerformanceTable from "./ItemizedPerformanceTable";
import ProfitLossSummary from "./ProfitLossSummary";

export default function FinanceOverview({
  startDate,
  endDate,
  businessType,
  locationId,
}: {
  startDate: string;
  endDate: string;
  businessType?: string | null;
  locationId?: string;
}) {
  return (
    <div className="space-y-6">
      <ProfitLossSummary
        startDate={startDate}
        endDate={endDate}
        locationId={locationId}
      />
      <ItemizedPerformanceTable
        startDate={startDate}
        endDate={endDate}
        businessType={businessType}
        locationId={locationId}
      />
      <FinancialBreakdown
        startDate={startDate}
        endDate={endDate}
        businessType={businessType}
        locationId={locationId}
      />
      <FinanceComparison
        startDate={startDate}
        endDate={endDate}
        locationId={locationId}
      />
    </div>
  );
}
