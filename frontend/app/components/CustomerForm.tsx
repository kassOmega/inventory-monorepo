"use client";
import { useToast } from "@/app/components/ToastProvider";
import Loading from "@/app/components/Loading";
import api, { markHandled } from "@/lib/api";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Mirrors the backend enum (prisma/schema.prisma → CustomerSource). */
export const CUSTOMER_SOURCES = [
  "WALK_IN",
  "REFERRAL",
  "ONLINE",
  "EVENT",
  "OTHER",
] as const;

interface Props {
  onCreated: (customer: any) => void;
  onUpdated?: (customer: any) => void;
  onCancel: () => void;
  /** Full customer row when editing. Legacy rows may lack the CRM fields. */
  initialData?: any | null;
  /** Show the section headings (used on the standalone profile page). */
  showSections?: boolean;
}

/**
 * The single customer form used everywhere — credits, sales, requests, the CRM
 * directory and the profile page — so a customer created at the till is as
 * complete as one added from the directory.
 */
export default function CustomerForm({
  onCreated,
  onUpdated,
  onCancel,
  initialData,
  showSections = false,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!initialData;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [birthday, setBirthday] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  // New customers are credit-eligible by default: creating somebody from the
  // credit-sale picker is the whole point of that flow (requirement R3).
  const [canTakeCredit, setCanTakeCredit] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!initialData) return;
    setName(initialData.name ?? "");
    setPhone(initialData.phone ?? "");
    setEmail(initialData.email ?? "");
    setAddress(initialData.address ?? "");
    setBirthday(
      initialData.birthday ? String(initialData.birthday).slice(0, 10) : "",
    );
    setTags((initialData.tags ?? []).join(", "));
    setNotes(initialData.notes ?? "");
    setSource(initialData.source ?? "");
    setPreferredLanguage(initialData.preferredLanguage ?? "");
    setCreditLimit(
      initialData.creditLimit != null ? String(initialData.creditLimit) : "",
    );
    setCanTakeCredit(initialData.canTakeCredit !== false);
  }, [initialData]);

  /** Blank means "clear it" when editing, "leave it out" when creating. */
  const text = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
    return isEdit ? null : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const limit = creditLimit.trim();
    const payload = {
      name: name.trim(),
      phone: text(phone),
      email: text(email),
      address: text(address),
      birthday: text(birthday),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      notes: text(notes),
      preferredLanguage: preferredLanguage
        ? preferredLanguage
        : isEdit
          ? null
          : undefined,
      source: source ? source : isEdit ? null : undefined,
      creditLimit:
        limit && Number.isFinite(Number(limit))
          ? Number(limit)
          : isEdit
            ? null
            : undefined,
      canTakeCredit,
    };
    try {
      if (isEdit) {
        const res = await api.put(`/customers/${initialData!.id}`, payload);
        onUpdated?.(res.data);
      } else {
        const res = await api.post("/customers", payload);
        onCreated(res.data);
      }
    } catch (err: any) {
      markHandled(err);
      toast.error(
        isEdit
          ? t("common.failedUpdateCustomer")
          : t("common.failedCreateCustomer"),
      );
    } finally {
      setLoading(false);
    }
  };

  const label = "block text-sm font-medium text-gray-500 mb-1";
  const input = "border p-2 rounded-lg w-full text-sm bg-white";

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {showSections && (
        <h3 className="sm:col-span-2 text-sm font-semibold text-gray-800">
          {t("crm.sectionContact")}
        </h3>
      )}
      <div>
        <label className={label}>{t("common.name")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={input}
          required
        />
      </div>
      <div>
        <label className={label}>{t("common.phone")}</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={input}
          placeholder={t("common.optional")}
        />
      </div>
      <div>
        <label className={label}>{t("common.email")}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          placeholder={t("common.optional")}
        />
      </div>
      <div>
        <label className={label}>{t("crm.address")}</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={input}
          placeholder={t("common.optional")}
        />
      </div>
      <div>
        <label className={label}>{t("crm.birthday")}</label>
        <input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          className={input}
        />
      </div>
      <div>
        <label className={label}>{t("crm.preferredLanguage")}</label>
        <select
          value={preferredLanguage}
          onChange={(e) => setPreferredLanguage(e.target.value)}
          className={input}
        >
          <option value="">{t("common.none")}</option>
          <option value="en">{t("language.english")}</option>
          <option value="am">{t("language.amharic")}</option>
        </select>
      </div>

      {showSections && (
        <h3 className="sm:col-span-2 text-sm font-semibold text-gray-800 mt-2">
          {t("crm.sectionProfile")}
        </h3>
      )}
      <div className="sm:col-span-2">
        <label className={label}>{t("crm.tags")}</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={input}
          placeholder={t("crm.tagsPlaceholder")}
        />
      </div>
      <div>
        <label className={label}>{t("crm.source")}</label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={input}
        >
          <option value="">{t("common.none")}</option>
          {CUSTOMER_SOURCES.map((value) => (
            <option key={value} value={value}>
              {t(`crm.source${value}`)}
            </option>
          ))}
        </select>
      </div>
      {showSections && (
        <h3 className="sm:col-span-2 text-sm font-semibold text-gray-800 mt-2">
          {t("crm.sectionCredit")}
        </h3>
      )}
      <div className="sm:col-span-2 rounded-lg border p-3 bg-gray-50">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={canTakeCredit}
            onChange={(e) => setCanTakeCredit(e.target.checked)}
          />
          {t("crm.canTakeCredit")}
        </label>
        <p className="text-xs text-gray-500 mt-1">
          {t("crm.canTakeCreditHint")}
        </p>
      </div>
      <div>
        <label className={label}>{t("crm.creditLimit")}</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={creditLimit}
          onChange={(e) => setCreditLimit(e.target.value)}
          className={input}
          placeholder={t("common.optional")}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={label}>{t("common.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={input}
          rows={2}
          placeholder={t("crm.notesHint")}
        />
      </div>
      <div className="flex gap-2 mt-2 sm:col-span-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loading size="sm" />
              {t("common.saving")}
            </span>
          ) : isEdit ? (
            t("common.updateCustomer")
          ) : (
            t("common.saveCustomer")
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
