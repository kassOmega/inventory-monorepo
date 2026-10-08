"use client";

import CarWashReport from "@/app/components/CarWashReport";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import FilterPanel from "@/app/components/FilterPanel";
import { useTranslation } from "react-i18next";
import { useState } from "react";

export default function CarWashReportsPage() {
  const { t } = useTranslation();
  const init = getDateRange("week");
  const [datePreset, setDatePreset] = useState<DatePreset>("week");
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(init.end);
  const [search, setSearch] = useState("");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("carwash.reports")}</h1>

      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.reports")}
      />

      <CarWashReport startDate={startDate} endDate={endDate} />
    </div>
  );
}
