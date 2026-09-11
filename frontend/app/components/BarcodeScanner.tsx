"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Html5Qrcode,
  Html5QrcodeCameraScanConfig,
  Html5QrcodeResult,
} from "html5-qrcode";
import Modal from "./Modal";
import { formatSymbologyLabel, normalizeScannedCode } from "@/lib/scan";

type ScanErrorCode = "blocked" | "nocamera" | "engine";

/**
 * The runtime accepts `formatsToSupport` / `experimentalFeatures` but the
 * bundled typings do not declare them, so we widen the config type.
 */
type ScanConfig = Html5QrcodeCameraScanConfig & {
  formatsToSupport?: number[];
  experimentalFeatures?: { useBarCodeDetectorIfSupported?: boolean };
};

interface BarcodeScannerProps {
  onScan: (sku: string) => void;
  label?: string;
  className?: string;
  /** Keep scanning after each read (for scanning multiple items in a row). */
  continuous?: boolean;
  /**
   * Symbologies to look for, by html5-qrcode enum name (e.g. ["QR_CODE",
   * "DATA_MATRIX", "PDF_417"]). Defaults to QR plus the retail/logistics 1D
   * set — pass a wider list for unusual labels, no code change needed.
   */
  formats?: string[];
}

/** Identical reads inside this window are ignored (re-aiming, wedge repeats). */
const DUPLICATE_WINDOW_MS = 1500;

/**
 * QR plus the barcode symbologies retail and supplier labels actually use:
 * EAN-13/EAN-8, UPC-A/UPC-E (+ add-ons), Code 128, Code 39, Code 93, ITF,
 * Codabar. Names match html5-qrcode's Html5QrcodeSupportedFormats enum.
 */
export const DEFAULT_SCAN_FORMATS = [
  "QR_CODE",
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "UPC_EAN_EXTENSION",
  "CODE_128",
  "CODE_39",
  "CODE_93",
  "ITF",
  "CODABAR",
];

/** Map a thrown value (or library error string) to a user-facing error code. */
function scanErrorCode(e: unknown): ScanErrorCode {
  const err = e as { name?: string; message?: string } | string | null;
  const name = err && typeof err === "object" ? err.name ?? "" : "";
  const text = typeof err === "string" ? err : err?.message ?? "";

  if (name === "NotAllowedError" || /not\s*allowed|permission/i.test(text)) {
    return "blocked";
  }
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    /no\s+camera|not\s*found|overconstrained/i.test(text)
  ) {
    return "nocamera";
  }
  return "engine";
}

/**
 * Camera-based barcode/QR scanner button. Opens the device camera (back camera),
 * reads 1D barcodes and 2D codes, and calls `onScan(code)` when something is
 * decoded. Also listens for keyboard "wedge" input (USB/Bluetooth scanners)
 * while the modal is open.
 */
export default function BarcodeScanner({
  onScan,
  label,
  className,
  continuous = false,
  formats,
}: BarcodeScannerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [errorCode, setErrorCode] = useState<ScanErrorCode | null>(null);
  const [result, setResult] = useState<{ code: string; format: string | null } | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scannerId] = useState(
    () => `qr-scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const continuousRef = useRef(continuous);
  const formatsRef = useRef(formats);
  const bufferRef = useRef("");
  const lastCodeRef = useRef("");
  const lastScanAtRef = useRef(0);

  // Keep the latest callback/props in refs (updated after render, not during).
  useEffect(() => {
    onScanRef.current = onScan;
    continuousRef.current = continuous;
    formatsRef.current = formats;
  });

  const stop = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // already stopped
    }
    try {
      scanner.clear();
    } catch {
      // nothing to clear
    }
    scannerRef.current = null;
  };

  const close = async () => {
    await stop();
    setOpen(false);
    setErrorCode(null);
    setResult(null);
    setTorchOn(false);
    setTorchAvailable(false);
  };

  /** Normalize + de-duplicate, then hand the value to the caller. */
  const handleScan = (raw: string, formatName: string | null) => {
    const code = normalizeScannedCode(raw);
    if (!code) return;

    const now = Date.now();
    if (
      code === lastCodeRef.current &&
      now - lastScanAtRef.current < DUPLICATE_WINDOW_MS
    ) {
      return;
    }
    lastCodeRef.current = code;
    lastScanAtRef.current = now;

    setResult({ code, format: formatName });
    onScanRef.current(code);
    if (!continuousRef.current) void close();
  };

  const toggleTorch = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    const next = !torchOn;
    try {
      // `torch` is an "advanced" video constraint (dimmable storerooms/shelves).
      await scanner.applyVideoConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
    }
  };

  // Start/stop the camera scanner while the modal is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        const requested = formatsRef.current?.length
          ? formatsRef.current
          : DEFAULT_SCAN_FORMATS;
        const enumMap = Html5QrcodeSupportedFormats as unknown as Record<string, number>;
        const formatsToSupport = requested
          .map((name) => enumMap[name])
          .filter((value): value is number => typeof value === "number");

        const config: ScanConfig = {
          fps: 15,
          // Barcodes never need mirrored decoding — skipping it saves a pass.
          disableFlip: true,
          // Wide + short scan region: 1D codes are horizontal strips, and a QR
          // square still fits comfortably inside it.
          qrbox: (viewfinderWidth: number) => ({
            width: Math.round(viewfinderWidth * 0.85),
            height: 140,
          }),
          formatsToSupport,
        };

        // Ask for the rear camera at a resolution that keeps thin bars crisp.
        const camera: MediaTrackConstraints = {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };

        const onSuccess = (decodedText: string, decodedResult: Html5QrcodeResult) => {
          if (cancelled) return;
          handleScan(decodedText, decodedResult?.result?.format?.formatName ?? null);
        };

        try {
          await scanner.start(camera, config, onSuccess, () => {});
        } catch (firstError) {
          // The library builds the native BarcodeDetector without intersecting
          // our format list with the device's supported formats, so on some
          // browsers that constructor throws and the whole scan aborts. Retry
          // with the pure-JS engine (ZXing) so every symbology still decodes.
          await stop();
          if (cancelled) return;
          const jsOnlyConfig: ScanConfig = {
            ...config,
            experimentalFeatures: { useBarCodeDetectorIfSupported: false },
          };
          await scanner.start(camera, jsOnlyConfig, onSuccess, () => {});
          console.warn("[scan] Retried with the JS engine after:", firstError);
        }

        if (cancelled) return;

        // Flashlight when the camera exposes it (dim storerooms/shelves).
        try {
          const caps = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
          if (caps?.torch) setTorchAvailable(true);
        } catch {
          // Capability is optional — ignore.
        }
      } catch (e) {
        if (!cancelled) setErrorCode(scanErrorCode(e));
      }
    };

    // Small delay so the modal's <div id> is mounted before we attach to it.
    const timer = setTimeout(startScanner, 150);

    // Support USB/Bluetooth keyboard-wedge scanners while the modal is open.
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code) handleScan(code, null);
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };
    window.addEventListener("keydown", keyHandler);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("keydown", keyHandler);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errorText =
    errorCode === "blocked"
      ? t("scan.errBlocked")
      : errorCode === "nocamera"
        ? t("scan.errNoCamera")
        : errorCode
          ? t("scan.errEngine")
          : "";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          bufferRef.current = "";
          lastCodeRef.current = "";
          lastScanAtRef.current = 0;
          setResult(null);
          setErrorCode(null);
          setOpen(true);
        }}
        className={
          className ??
          "px-3 rounded-lg text-sm font-medium whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700"
        }
      >
        {label ?? t("scan.button")}
      </button>

      <Modal isOpen={open} onClose={close} title={t("scan.title")}>
        <div className="space-y-3">
          <div
            id={scannerId}
            className="w-full overflow-hidden rounded-lg bg-black"
            style={{ minHeight: 280 }}
          />

          {errorText ? (
            <p className="text-sm text-red-500">
              {errorText} {t("scan.httpsHint")}
            </p>
          ) : (
            <p className="text-sm text-gray-500">{t("scan.hint")}</p>
          )}

          {result && (
            <p className="text-sm font-medium text-emerald-600">
              {result.format
                ? t("scan.detected", { format: formatSymbologyLabel(result.format) })
                : t("scan.detectedPlain")}
              : <span className="font-mono">{result.code}</span>
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {torchAvailable ? (
              <button
                type="button"
                onClick={toggleTorch}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium text-gray-700"
              >
                {torchOn ? t("scan.torchOff") : t("scan.torchOn")}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700"
            >
              {t("scan.close")}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
