"use client";

// Manage public QR links: create entries per table/branch/hotel/bay, set their
// state (live/held/dropped) + auto-approve toggle, and print the
// QR sheet, and manage the phone blocklist.
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";


export default function QrCodesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("qr.manage");

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [blocklist, setBlocklist] = useState<any[]>([]);


  const [printEntry, setPrintEntry] = useState<any | null>(null);
  const [blockPhone, setBlockPhone] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = async () => {
    try {
      const [e, l, b] = await Promise.all([
        // entries auto-prepares the business's QRs (idempotent) server-side.
        api.get("/guest-orders/qr/entries"),
        api.get("/locations").catch(() => ({ data: [] })),
        api.get("/guest-orders/qr/blocklist").catch(() => ({ data: [] })),
      ]);
      setEntries(Array.isArray(e.data) ? e.data : []);
      setLocations(Array.isArray(l.data) ? l.data : l.data?.data ?? []);
      setBlocklist(Array.isArray(b.data) ? b.data : []);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = (token: string) => `${origin}/o/${token}`;

  const setState = (entry: any, state: string) =>
    api
      .patch(`/guest-orders/qr/entries/${entry.id}`, { state })
      .then(load)
      .catch(() => toast.error("Failed"));

  const remove = async (entry: any) => {
    if (!(await confirm(t("qr.deleteConfirm")))) return;
    await api.delete(`/guest-orders/qr/entries/${entry.id}`).catch(() => {});
    await load();
  };




  if (loading) return <Loading className="py-24" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("qr.title")}</h1>
          <p className="text-xs text-gray-400">{t("qr.autoHint")}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">{t("qr.label")}</th>
              <th className="px-3 py-2">{t("qr.kind")}</th>
              <th className="px-3 py-2">{t("common.status")}</th>
              <th className="px-3 py-2">{t("qr.autoApprove")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 font-medium text-gray-800">
                  {e.label}
                  {e.table?.name ? (
                    <span className="block text-[11px] text-gray-400">{e.table.name}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {e.serviceType ? (
                    <>
                      {t(`qr.serviceType.${e.serviceType}`, {
                        defaultValue: e.serviceType,
                      })}
                      <span className="block text-[11px] text-gray-400">
                        {t(`qr.kind_${e.kind}`, { defaultValue: e.kind })}
                      </span>
                    </>
                  ) : (
                    t(`qr.kind_${e.kind}`, { defaultValue: e.kind })
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={e.state}
                    onChange={(ev) => setState(e, ev.target.value)}
                    disabled={!canManage}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white disabled:opacity-60"
                  >
                    <option value="LIVE">{t("qr.state.LIVE")}</option>
                    <option value="HELD">{t("qr.state.HELD")}</option>
                    <option value="DROPPED">{t("qr.state.DROPPED")}</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!e.autoApprove}
                      disabled={!canManage}
                      onChange={() =>
                        api
                          .patch(`/guest-orders/qr/entries/${e.id}`, {
                            autoApprove: !e.autoApprove,
                          })
                          .then(load)
                          .catch(() => toast.error("Failed"))
                      }
                    />
                    {t("qr.autoApprove")}
                  </label>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setPrintEntry(e)} className="text-xs text-gray-600 hover:underline mr-3">
                    {t("qr.print")}
                  </button>
                  {canManage && (
                    <button onClick={() => remove(e)} className="text-xs text-red-600 hover:underline">
                      {t("common.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                  {t("qr.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Blocklist */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-800 mb-2">{t("qr.blocklist")}</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={blockPhone}
            onChange={(e) => setBlockPhone(e.target.value)}
            placeholder={t("public.phone")}
            className="border border-gray-300 rounded-lg p-2 text-sm flex-1 max-w-xs"
          />
          <Button
            size="sm"
            disabled={!blockPhone}
            onClick={async () => {
              await api.post("/guest-orders/qr/blocklist", { phone: blockPhone }).catch(() => {});
              setBlockPhone("");
              await load();
            }}
          >
            {t("qr.block")}
          </Button>
        </div>
        <ul className="text-xs divide-y divide-gray-100">
          {blocklist.map((b) => (
            <li key={b.id} className="flex justify-between py-1.5">
              <span className="font-mono">{b.phone}</span>
              <button
                onClick={async () => {
                  await api.delete(`/guest-orders/qr/blocklist/${b.id}`).catch(() => {});
                  await load();
                }}
                className="text-red-600 hover:underline"
              >
                {t("qr.unblock")}
              </button>
            </li>
          ))}
          {blocklist.length === 0 && <li className="py-2 text-gray-400">{t("qr.noBlocked")}</li>}
        </ul>
      </div>

      {/* Create modal */}
      {/* Print sheet */}
      <Modal isOpen={!!printEntry} onClose={() => setPrintEntry(null)} title={t("qr.print")}>
        {printEntry && (
          <div className="text-center space-y-3">
            <div id="qr-print" className="bg-white p-6 border rounded-xl inline-block">
              <p className="font-bold text-gray-800 mb-3">{printEntry.label}</p>
              <QRCodeSVG value={url(printEntry.token)} size={220} />
              <p className="text-[11px] text-gray-400 mt-3">{url(printEntry.token)}</p>
              <p className="text-xs text-gray-500 mt-1">{t("qr.scanHint")}</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => window.print()}>{t("common.print")}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
