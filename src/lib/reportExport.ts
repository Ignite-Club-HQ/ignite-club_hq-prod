import { Capacitor } from "@capacitor/core";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "report";
}

/**
 * Write a text report (HTML/CSV) to the native cache directory and open it
 * with the platform's default handler so the user can view, print, or share
 * it. Used because print windows and blob-anchor downloads do not work
 * inside the native WebView.
 */
async function openTextFileNative(content: string, fileName: string, mimeType: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { FileOpener } = await import("@capacitor-community/file-opener");

  const safeName = `report-${Date.now()}-${sanitizeFileName(fileName)}`;
  const written = await Filesystem.writeFile({
    path: safeName,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const uri =
    written.uri ||
    (await Filesystem.getUri({ path: safeName, directory: Directory.Cache })).uri;
  if (!uri) throw new Error("Report write produced no local path");

  await FileOpener.open({
    filePath: uri,
    contentType: mimeType,
    openWithDefault: true,
  });
}

/**
 * Open an HTML report.
 * - Native: writes to cache and opens the default HTML viewer (from there the
 *   user can print/save as PDF/share).
 * - Web: opens a print window. Returns "popup_blocked" if the popup failed.
 */
export async function openHtmlReport(
  html: string,
  fileName: string,
): Promise<"opened" | "popup_blocked"> {
  if (Capacitor.isNativePlatform()) {
    await openTextFileNative(
      html,
      fileName.endsWith(".html") ? fileName : `${fileName}.html`,
      "text/html",
    );
    return "opened";
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) return "popup_blocked";
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Wait for images to load before printing.
  setTimeout(() => printWindow.print(), 500);
  return "opened";
}

/**
 * Download a text report (e.g. CSV).
 * - Native: writes to cache and opens with the default handler.
 * - Web: blob + anchor download.
 */
export async function downloadTextReport(
  content: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await openTextFileNative(content, fileName, mimeType);
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
}
