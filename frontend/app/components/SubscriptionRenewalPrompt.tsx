"use client";

// Renewal prompt (the "nag"). The active business's subscription is checked on
// mount (so it re-appears on every login / page load of the dashboard shell) and
// again every 2 hours while the app is open. It shows when the subscription is
// expiring within the warning window, in grace, or expired — INCLUDING while the
// free trial is running out. FREE / LIFETIME tenants never see it.
//
// It is deliberately "nagging": dismissing only hides the CURRENT prompt; the
// next login or the next 2-hour tick brings it back while the condition holds.
import Modal from "./Modal";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { effectiveStatus } from "@/lib/subscriptions";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Re-check and re-nag every 2 hours while the app stays open. */
const NAG_INTERVAL_MS = 2 * 60 * 60 * 1000;
/** Show the warning this many days before expiry. */
const WARN_DAYS = 7;

export default function SubscriptionRenewalPrompt() {
  const { t } = useTranslation();
  const { user, activeOrganizationId } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(false);
  // Guards against clobbering state after unmount / org switch.
  const orgRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user || user.isPlatformAdmin || activeOrganizationId == null) return;
    orgRef.current = activeOrganizationId;

    const check = async () => {
      try {
        const r = await api.get("/subscriptions/me");
        if (orgRef.current !== activeOrganizationId) return;
        const sub = r.data;
        const status = effectiveStatus(sub);
        if (status === "FREE" || status === "LIFETIME") return;

        if (status === "EXPIRED") {
          setExpired(true);
          setMessage(t("subscription.readOnly"));
          setOpen(true);
        } else if (status === "GRACE") {
          setExpired(false);
          setMessage(t("subscription.inGrace", { count: 2 + (sub.daysLeft ?? 0) }));
          setOpen(true);
        } else if (sub.daysLeft != null && sub.daysLeft <= WARN_DAYS) {
          setExpired(false);
          setMessage(
            sub.isTrial
              ? sub.daysLeft <= 0
                ? t("subscription.trialEndsToday")
                : t("subscription.trialEndsInDays", { count: sub.daysLeft })
              : sub.daysLeft <= 0
                ? t("subscription.expiresToday")
                : t("subscription.expiresInDays", { count: sub.daysLeft }),
          );
          setOpen(true);
        }
      } catch {
        // No subscription info → stay silent.
      }
    };

    // On mount (every login / dashboard load) …
    check();
    // … and every 2 hours while the app stays open.
    const id = setInterval(check, NAG_INTERVAL_MS);
    return () => {
      clearInterval(id);
      orgRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeOrganizationId]);

  const dismiss = () => setOpen(false);

  return (
    <Modal isOpen={open} onClose={dismiss} title={t("subscription.title")}>
      <div className="space-y-4 text-sm">
        <p className={expired ? "text-red-600" : "text-amber-700"}>{message}</p>
        <p className="text-xs text-gray-500">{t("subscription.nagHint")}</p>
        <div className="flex justify-end gap-2">
          <button onClick={dismiss} className="px-3 py-2 text-sm text-gray-600">
            {t("common.close")}
          </button>
          <a
            href="/dashboard/businesses/subscription"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            {t("subscription.renewCta")}
          </a>
        </div>
      </div>
    </Modal>
  );
}
