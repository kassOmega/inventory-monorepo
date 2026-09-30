// Hand a generated file to the device's share sheet (WhatsApp, Telegram,
// e-mail, …) instead of saving it to the device.
//
// The builders in this app produce their files in memory (a Blob, or a jsPDF
// document whose `output("blob")` is a Blob), so the bytes travel straight from
// memory to whichever app the user picks: nothing lands in the Downloads
// folder. That is what staff on phones expect when they are standing in front
// of a customer.
//
// File sharing is only exposed on secure origins and on platforms that
// implement it (Android, iOS, recent desktop Chrome/Edge), so callers ask
// canShareFiles() first: when it is false they keep the plain Download button
// and simply do not render a Share action.
//
// The same helpers serve both generated documents (the price list and the QR
// label sheet), so keep the API file-agnostic.

/** A stand-in document used to ask the platform whether it shares PDFs. */
function probeFile(): File {
  return new File([""], "file.pdf", { type: "application/pdf" });
}

/**
 * True when this browser can hand files to the OS share sheet. Safe to call
 * during render: it only queries the platform, it never opens the sheet.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function") return false;
  // Older engines ship navigator.share without canShare; without the second
  // check we would open a sheet that cannot carry the file at all.
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [probeFile()] });
  } catch {
    return false;
  }
}

/**
 * Open the OS share sheet for `file` and resolve once the user is done.
 *
 * `"cancelled"` means the sheet was dismissed — a normal outcome, not a
 * failure, so callers close quietly instead of raising a toast. Anything else
 * is rethrown for the caller to report.
 */
export async function shareFile(
  file: File,
  title?: string,
): Promise<"shared" | "cancelled"> {
  try {
    await navigator.share(title ? { files: [file], title } : { files: [file] });
    return "shared";
  } catch (err) {
    // Dismissing the sheet rejects with an AbortError; some engines reject with
    // a plain object, so match on the name rather than the DOMException class.
    if ((err as { name?: string } | null)?.name === "AbortError") {
      return "cancelled";
    }
    throw err;
  }
}
