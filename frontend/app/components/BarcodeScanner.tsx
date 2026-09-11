"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Html5Qrcode,
  Html5QrcodeCameraScanConfig,
  Html5QrcodeResult,
} from "html5-qrcode";
import Modal from "./Modal";
import {
  SCANNER_CAMERA,
  SCANNER_VIDEO_CONSTRAINTS,
  formatSymbologyLabel,
  nextScanGuard,
  normalizeScannedCode,
  type ScanGuard,
} from "@/lib/scan";

type ScanErrorCode = "blocked" | "nocamera" | "busy" | "engine";

/** html5-qrcode format name → the BarcodeDetector enum value it maps onto. */
const NATIVE_FORMAT_NAMES: Record<string, string> = {
  QR_CODE: "qr_code",
  AZTEC: "aztec",
  CODABAR: "codabar",
  CODE_39: "code_39",
  CODE_93: "code_93",
  CODE_128: "code_128",
  DATA_MATRIX: "data_matrix",
  ITF: "itf",
  EAN_13: "ean_13",
  EAN_8: "ean_8",
  PDF_417: "pdf417",
  UPC_A: "upc_a",
  UPC_E: "upc_e",
};

/**
 * The native BarcodeDetector constructor throws when any requested format is not
 * supported by the device, and html5-qrcode does not intersect our list with the
 * device's. So take the native path only when it can handle everything we ask
 * for — otherwise the pure-JS engine (ZXing) starts up instead, and it covers
 * all of these formats anyway. Probing here is what stops the scanner from dying
 * on start with a misleading "could not start" error.
 */
async function canUseNativeDetector(formatNames: string[]): Promise<boolean> {
  const detector = (
    window as unknown as {
      BarcodeDetector?: { getSupportedFormats?: () => Promise<string[]> };
    }
  ).BarcodeDetector;
  if (!detector?.getSupportedFormats) return false;
  try {
    const supported = await detector.getSupportedFormats();
    return formatNames.every((name) => {
      const native = NATIVE_FORMAT_NAMES[name];
      return !!native && supported.includes(native);
    });
  } catch {
    return false;
  }
}

/** Raw text of a thrown value, shown small in the UI to aid diagnosis. */
function errorDetail(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

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
    name === "NotReadableError" ||
    name === "AbortError" ||
    /not\s*readable|in use|busy|aborted/i.test(text)
  ) {
    return "busy";
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
  const [errorDetailText, setErrorDetailText] = useState<string | null>(null);
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
  // Scan-acceptance guard: a code is refused while it is still in view, so
  // holding a barcode steady cannot add the same item twice.
  const guardRef = useRef<ScanGuard>({ code: "", at: 0 });
  const codeInFrameRef = useRef(false);

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
    setErrorDetailText(null);
    setResult(null);
    setTorchOn(false);
    setTorchAvailable(false);
    codeInFrameRef.current = false;
  };

  /** Normalize, guard against repeats, then hand the value to the caller. */
  const handleScan = (raw: string, formatName: string | null) => {
    const code = normalizeScannedCode(raw);
    if (!code) return;

    const decision = nextScanGuard(
      guardRef.current,
      code,
      Date.now(),
      codeInFrameRef.current,
    );
    if (!decision.accept) return;
    guardRef.current = decision.guard;
    codeInFrameRef.current = true;

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
        let scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        const requested = formatsRef.current?.length
          ? formatsRef.current
          : DEFAULT_SCAN_FORMATS;
        const enumMap = Html5QrcodeSupportedFormats as unknown as Record<string, number>;
        const formatsToSupport = requested
          .map((name) => enumMap[name])
          .filter((value): value is number => typeof value === "number");

        // Probe the device first: the native detector's constructor throws for a
        // format it does not support and the library hands it our whole list, so
        // only take the native path when it can cover everything we ask for.
        const nativeSupported = await canUseNativeDetector(requested);
        if (cancelled) return;

        const config: ScanConfig = {
          fps: 15,
          // Barcodes never need mirrored decoding — skipping it saves a pass.
          disableFlip: true,
          // Wide + short scan region: 1D codes are horizontal strips, and a QR
          // square still fits comfortably inside it. Clamped to the viewfinder so
          // the library can never reject the box while the modal animates in.
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
            width: Math.round(viewfinderWidth * 0.92),
            height: Math.max(
              110,
              Math.min(190, Math.round(viewfinderHeight * 0.7)),
            ),
          }),
          formatsToSupport,
          // Preferred capture resolution lives here: the start() camera argument
          // only accepts a single key (see SCANNER_CAMERA).
          videoConstraints: SCANNER_VIDEO_CONSTRAINTS,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: nativeSupported,
          },
        };

        // html5-qrcode takes a camera-id string or a ONE-key object here — extra
        // keys make it throw before the camera ever opens.
        const camera = SCANNER_CAMERA;

        const onSuccess = (decodedText: string, decodedResult: Html5QrcodeResult) => {
          if (cancelled) return;
          handleScan(decodedText, decodedResult?.result?.format?.formatName ?? null);
        };

        // Called for every frame in which nothing decodes: the code that was just
        // accepted has left the frame, so it may be scanned again (next unit).
        const onFrameMiss = () => {
          codeInFrameRef.current = false;
        };

        try {
          await scanner.start(camera, config, onSuccess, onFrameMiss);
        } catch (firstError) {
          // Something still went wrong (busy camera, engine hiccup). Clean up and
          // retry once on a FRESH instance with the JS engine only: reusing the
          // instance whose start() failed trips the library's state machine and
          // surfaces as a bogus "could not start" error.
          console.warn(
            "[scan] start failed, retrying with the JS engine:",
            firstError,
          );
          try {
            await scanner.stop();
          } catch {
            // never started
          }
          try {
            scanner.clear();
          } catch {
            // nothing attached
          }
          if (cancelled) return;
          scanner = new Html5Qrcode(scannerId);
          scannerRef.current = scanner;
          const jsOnlyConfig: ScanConfig = {
            ...config,
            // Minimal constraints: if the preferred resolution request was the
            // problem, this retry still gets a camera.
            videoConstraints: SCANNER_CAMERA,
            experimentalFeatures: { useBarCodeDetectorIfSupported: false },
          };
          await scanner.start(camera, jsOnlyConfig, onSuccess, onFrameMiss);
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
        console.error("[scan] start failed:", e);
        if (!cancelled) {
          setErrorCode(scanErrorCode(e));
          setErrorDetailText(errorDetail(e));
        }
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
        : errorCode === "busy"
          ? t("scan.errBusy")
          : errorCode
            ? t("scan.errEngine")
            : "";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          bufferRef.current = "";
          guardRef.current = { code: "", at: 0 };
          codeInFrameRef.current = false;
          setResult(null);
          setErrorCode(null);
          setErrorDetailText(null);
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
          {/* Viewfinder: kept small and centred — the camera fills the width of
              the modal otherwise, and the preview would dominate the screen. */}
          <div
            id={scannerId}
            className="mx-auto w-full max-w-[240px] sm:max-w-[280px] overflow-hidden rounded-lg bg-black"
            style={{ minHeight: 200 }}
          />

          {errorText ? (
            <div className="space-y-1">
              <p className="text-sm text-red-500">{errorText}</p>
              {(errorCode === "blocked" || errorCode === "nocamera") && (
                <p className="text-xs text-gray-500">{t("scan.httpsHint")}</p>
              )}
              {errorDetailText && (
                <p className="text-[11px] text-gray-400 break-words">
                  {errorDetailText}
                </p>
              )}
            </div>
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
