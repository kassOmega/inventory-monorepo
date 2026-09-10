"use client";
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";

interface BarcodeScannerProps {
  onScan: (sku: string) => void;
  label?: string;
  className?: string;
  /** Keep scanning after each read (for scanning multiple items in a row). */
  continuous?: boolean;
}

/**
 * Camera-based barcode/QR scanner button. Opens the device camera (back camera)
 * and calls `onScan(code)` when a code is decoded. Also listens for keyboard
 * "wedge" input (USB/Bluetooth scanners) while the modal is open.
 */
export default function BarcodeScanner({
  onScan,
  label = "Scan",
  className,
  continuous = false,
}: BarcodeScannerProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [scannerId] = useState(
    () => `qr-scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const scannerRef = useRef<any>(null);
  const onScanRef = useRef(onScan);
  const continuousRef = useRef(continuous);
  const bufferRef = useRef("");

  // Keep the latest callback/props in refs (updated after render, not during).
  useEffect(() => {
    onScanRef.current = onScan;
    continuousRef.current = continuous;
  });

  const stop = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // already stopped
      }
      try {
        scannerRef.current.clear();
      } catch {
        // nothing to clear
      }
      scannerRef.current = null;
    }
  };

  const close = async () => {
    await stop();
    setOpen(false);
    setError("");
  };

  const handleScan = (text: string) => {
    const sku = text.trim();
    if (!sku) return;
    onScanRef.current(sku);
    if (!continuousRef.current) close();
  };

  // Start/stop the camera scanner while the modal is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10 },
          (decodedText) => {
            if (!cancelled) handleScan(decodedText);
          },
          () => {},
        );
      } catch (e: any) {
        if (!cancelled) {
          setError(
            typeof e === "string"
              ? e
              : e?.message || "Unable to access the camera.",
          );
        }
      }
    };

    // Small delay so the modal's <div id> is mounted before we attach to it.
    const t = setTimeout(startScanner, 150);

    // Support USB/Bluetooth keyboard-wedge scanners while the modal is open.
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const sku = bufferRef.current.trim();
        bufferRef.current = "";
        if (sku) handleScan(sku);
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };
    window.addEventListener("keydown", keyHandler);

    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener("keydown", keyHandler);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          bufferRef.current = "";
          setOpen(true);
        }}
        className={
          className ??
          "px-3 rounded-lg text-sm font-medium whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700"
        }
      >
        {label}
      </button>

      <Modal isOpen={open} onClose={close} title="Scan Barcode / QR Code">
        <div className="space-y-3">
          <div
            id={scannerId}
            className="w-full overflow-hidden rounded-lg bg-black"
            style={{ minHeight: 280 }}
          />
          {error ? (
            <p className="text-red-500 text-sm">
              {error}. Make sure this app is served over HTTPS and that you
              allowed camera access.
            </p>
          ) : (
            <p className="text-sm text-gray-500">
              Point your camera at a barcode or QR code — it will scan
              automatically.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

