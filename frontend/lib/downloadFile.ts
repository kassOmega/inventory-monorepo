// Download a file produced by the API (PDF/CSV exports) with the auth header.
import api from "./api";

export async function downloadApiFile(
  path: string,
  filename: string,
): Promise<void> {
  const res = await api.get(path, { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
