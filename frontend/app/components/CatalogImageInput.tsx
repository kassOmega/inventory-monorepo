"use client";

// Upload + preview for a catalogue image (product / variant / menu item / room
// type / service item). Stores the returned file name via onChange; the public
// page renders it from /api/public/image/<file>.
import api from "@/lib/api";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Loading from "./Loading";

export default function CatalogImageInput({
  value,
  onChange,
  label,
}: {
  value?: string | null;
  onChange: (file: string | null) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preview = value ? `/api/public/image/${value}` : null;

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/uploads/catalog-image", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange(r.data.file);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("catalog.imageFail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-sm">
      {label && <p className="mb-1 text-xs font-medium text-gray-500">{label}</p>}
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 rounded-lg bg-gray-100 border overflow-hidden flex items-center justify-center shrink-0">
          {busy ? (
            <Loading size="sm" />
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-gray-300 text-2xl">🖼️</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-60"
            >
              {preview ? t("catalog.replaceImage") : t("catalog.addImage")}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-xs text-red-600 hover:underline"
              >
                {t("common.remove")}
              </button>
            )}
          </div>
          {error && <span className="text-[11px] text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
