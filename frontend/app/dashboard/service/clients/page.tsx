"use client";

import api from "@/lib/api";
import ClearableInput from "@/app/components/ClearableInput";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function ServiceClientsPage() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get(`/service/clients${search ? `?search=${encodeURIComponent(search)}` : ""}`)
      .then((r) => setClients(r.data))
      .catch(() => {});
  }, [search]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("nav.serviceClients")}</h1>
      <ClearableInput
        value={search}
        onChange={setSearch}
        placeholder={t("facility.searchMembersPh")}
        className="w-full max-w-sm"
        inputClassName="border border-gray-300 rounded p-2 text-sm w-full"
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
