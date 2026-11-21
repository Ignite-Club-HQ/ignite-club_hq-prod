/** Download authorized, decrypted bytes with the document's original name. */
export async function downloadResolvedFile(url: string, fileName: string, mimeType?: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Access was refused or this file link expired. Sign in again and retry."
    : response.status === 404 ? "This file is missing. Ask the organiser to upload it again."
    : "We couldn't download this file. Check your connection and try again.");
  const original = await response.blob();
  if (original.size === 0) throw new Error("This file is empty. Ask the organiser to upload it again.");
  const blob = mimeType?.includes("/") ? new Blob([original], { type: mimeType }) : original;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  const deliver = () => {
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
  };
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) {
    const { toast } = await import("sonner");
    toast("File ready to download", { duration: 60000, action: { label: "Download", onClick: deliver } });
  } else { deliver(); }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
}

export async function downloadStoredFile(url: string, fileName: string, mimeType?: string): Promise<void> {
  const { runFileAction } = await import("./safeOpenFile");
  await runFileAction("download", url, { fileName, mimeType });
}