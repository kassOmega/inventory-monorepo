"use client";

import { useState } from "react";
import { useToast } from "@/app/components/ToastProvider";
import { useTranslation } from "react-i18next";
import { markHandled } from "@/lib/api";
import AiPhotoPicker from "./AiPhotoPicker";

interface AiAutofillCaptureProps {
  /** When false, nothing renders (mirrors the caller's `canUseAi` gate). */
  enabled?: boolean;
  /** Calls the AI endpoint with the captured images and returns the suggestion. */
  analyze: (images: string[]) => Promise<any>;
  /** Applies the suggestion to the form (a success toast may live here). */
  onResult: (data: any) => void;
  buttonLabel?: string;
  /** Static hint line rendered under the button. */
  banner?: string;
  /** Fallback toast text when the server returns no message. */
  errorMessage?: string;
  className?: string;
}

/**
 * Shared AI autofill capture. Owns the capture → analyze → apply → error-toast
 * sequence so every AI-assisted form keeps the exact same flow (busy state,
 * `markHandled`, toast on failure). The caller supplies only its endpoint call
 * (`analyze`) and field mapping (`onResult`).
 */
export default function AiAutofillCapture({
  enabled = true,
  analyze,
  onResult,
  buttonLabel,
  banner,
  errorMessage,
  className = "",
}: AiAutofillCaptureProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!enabled) return null;

  const handleImages = async (images: string[]) => {
    if (images.length === 0) return;
    setBusy(true);
    try {
      const data = await analyze(images);
      onResult(data);
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message || errorMessage || t("scan.aiPhotoError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <AiPhotoPicker
        onImages={handleImages}
        busy={busy}
        buttonLabel={buttonLabel}
      />
      {banner && (
        <p className="text-[11px] text-gray-400 mt-1">{banner}</p>
      )}
    </div>
  );
}
