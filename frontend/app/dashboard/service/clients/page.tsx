"use client";

import api from "@/lib/api";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import { useEffect, useState } from "react";
import useDebouncedValue from "@/lib/useDebouncedValue";
import { useTranslation } from "react-i18next";

export default function ServiceClientsPage() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    api
      .get(`/service/clients${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`)
      .then((r) => setClients(r.data))
      .catch(() => {});
  }, [debouncedSearch]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("nav.serviceClients")}</h1>
      <CollapsibleFilterPanel
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("facility.searchMembersPh")}
      />
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {clients.map((c) => (
            <li key={c.id} className="px-4 py-3 flex justify-between">
              <span className="font-medium text-gray-800">{c.name}</span>
              <span className="text-xs text-gray-400">{c.phone ?? "—"}</span>
            </li>
          ))}
          {clients.length === 0 && <li className="px-4 py-6 text-center text-gray-400">{t("svc.cl.empty")}</li>}
        </ul>
      </div>
    </div>
  );
}
