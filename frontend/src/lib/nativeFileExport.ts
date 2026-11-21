import { registerPlugin } from "@capacitor/core";

export const NativeFileExport = registerPlugin<{
  save(options: { filePath: string; fileName: string; mimeType: string }): Promise<{ saved: boolean }>;
}>("NativeFileExport");