"use client";

// Guest ID Types registry — the identification document types the front desk can
// pick from at check-in.
//
// Extracted from the hotel page so the owner configures it once in the
// Hospitality Services settings (where every other hospitality setting lives);
// the hotel page keeps only the read that feeds the check-in modal.
//
// API: GET /hotel/settings/id-types (tenant-scoped via the X-Tenant-Id header),
// POST /hotel/settings/id-types, PATCH /hotel/settings/id-types/:id — writes are
// gated on `hotel.manage`, so the card is safe to mount anywhere.
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function GuestIdTypesCard({
  orgId,
  title,
  hint,
  note,
  onChanged,
  className = "",
}: {
  /** Active organization the registry belongs to; changing it refetches. */
  orgId?: number | null;
  title?: string;
  hint?: string;
  /** Optional extra line under the hint (e.g. "the check-in screen lists these"). */
  note?: string;
  onChanged?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("hotel.manage");

  const [idTypes, setIdTypes] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", requiresExpiry: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/hotel/settings/id-types");
      setIdTypes(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("hotel.failedLoadIdTypes"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when the caller switches business: the tenant header comes from
  // localStorage.activeOrganizationId, which the settings page updates first.
  useEffect(() => {
    setError("");
    setNotice("");
    load();
  }, [orgId, load]);

  const addType = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api.post("/hotel/settings/id-types", {
        name: form.name,
        requiresExpiry: form.requiresExpiry,
      });
      setForm({ name: "", requiresExpiry: false });
      await load();
      setNotice(t("hotel.idTypeAdded"));
      onChanged?.();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedAddIdType"));
    } finally {
      setBusy(false);
    }
  };

  const toggleType = async (type: any) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api.patch(`/hotel/settings/id-types/${type.id}`, {
        isActive: !type.isActive,
      });
      await load();
      setNotice(
        type.isActive
          ? t("hotel.idTypeDeactivated")
          : t("hotel.idTypeActivated"),
      );
      onChanged?.();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedUpdateIdType"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`bg-white p-4 rounded-lg border border-gray-200 ${className}`}
    >
      <div className="mb-3">
        <h2 className="font-semibold text-gray-800">
          {title ?? t("hotel.idTypesHeading")}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {hint ?? t("hotel.idTypesHint")}
        </p>
        {note && <p className="text-xs text-gray-400 mt-1">{note}</p>}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-2 rounded text-xs mb-3">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-green-50 text-green-700 p-2 rounded text-xs mb-3">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm py-4 text-center">…</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {idTypes.map((x) => (
            <li
              key={x.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span
                className={
                  x.isActive ? "text-gray-700" : "text-gray-400 line-through"
                }
              >
                {x.name}
                <span className="text-xs text-gray-400"> · {x.code}</span>
                {x.requiresExpiry && (
                  <span className="text-xs text-gray-400">
                    {" "}
                    · {t("hotel.requiresExpiry")}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] ${
                    x.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {x.isActive ? t("hotel.isActive") : t("hotel.inactive")}
                </span>
                {canManage && (
                  <button
                    onClick={() => toggleType(x)}
                    disabled={busy}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-60"
                  >
                    {x.isActive ? t("hotel.deactivate") : t("hotel.activate")}
                  </button>
                )}
              </div>
            </li>
          ))}
          {idTypes.length === 0 && (
            <li className="px-3 py-4 text-sm text-gray-400 text-center">
              {t("hotel.noIdTypes")}
            </li>
          )}
        </ul>
      )}

      {canManage ? (
        <form
          onSubmit={addType}
          className="flex flex-wrap items-center gap-2 mt-3"
        >
          <input
            placeholder={t("hotel.idTypeNamePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-gray-300 rounded p-2 text-sm flex-1"
            required
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={form.requiresExpiry}
              onChange={(e) =>
                setForm({ ...form, requiresExpiry: e.target.checked })
              }
            />
            {t("hotel.requiresExpiry")}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {t("hotel.addIdType")}
          </button>
        </form>
      ) : (
        <p className="text-xs text-gray-400 mt-3">
          {t("hotel.idTypesReadOnly")}
        </p>
      )}
    </div>
  );
}

