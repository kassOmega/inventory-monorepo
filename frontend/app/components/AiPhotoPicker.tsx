"use client";

import { useRef } from "react";

/**
 * Reusable AI photo picker: one button that opens the native OS sheet, which
 * offers camera capture plus Photo Library / Files on every mobile browser.
 *
 * Downscales up to 2 selected images to ~1000px JPEG and returns their base64
 * data-URLs via onImages (never uploaded to storage).
 */
export default function AiPhotoPicker({
  onImages,
  busy = false,
  compact = false,
  buttonLabel,
}: {
  onImages: (images: string[]) => void;
  busy?: boolean;
  compact?: boolean;
  buttonLabel?: string;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);

  const downscaleToJpegBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the image"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid image file"));
        img.onload = () => {
          const MAX = 1000;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            const scale = Math.min(MAX / width, MAX / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas is not supported"));
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handleFiles = async (list: FileList | null) => {
    if (busy) return;
    const files = Array.from(list ?? []).slice(0, 2);
    if (files.length === 0) return;
    try {
      const images = await Promise.all(files.map((f) => downscaleToJpegBase64(f)));
      onImages(images);
    } catch {
      // consumer shows the toast
    } finally {
      if (galleryRef.current) galleryRef.current.value = "";
    }
  };

  // Compact mode: a single small 📷 button backed by the no-capture input, so
  // the OS picker offers Camera + Gallery + Files on every mobile browser.
  if (compact) {
    return (
      <>
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={busy}
          title="AI scan product (photo or barcode)"
          aria-label="AI scan product"
          className="border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 px-2 py-1 rounded-lg text-sm font-medium whitespace-nowrap"
        >
          📷 {buttonLabel ?? "AI scan"}
        </button>
      </>
    );
  }

  return (
    <>
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => galleryRef.current?.click()}
        disabled={busy}
        className="w-full border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 py-2.5 px-4 rounded-lg text-sm font-medium"
      >
        {busy ? "✨ AI is reading the photo(s)…" : buttonLabel ?? "📷 Take Photo"}
      </button>
    </>
  );
}
