/**
 * Android WebView revokes read access to picked files shortly after the
 * picker closes (NotReadableError: "The requested file could not be read…").
 * Copy the bytes into memory immediately so a later upload still works.
 * Throws PickedFileUnreadableError when the file is already unreadable.
 */
export class PickedFileUnreadableError extends Error {
  constructor() {
    super("That file couldn't be opened. Please pick it again.");
    this.name = "PickedFileUnreadableError";
  }
}

export async function materializePickedFile(file: File): Promise<File> {
  try {
    const bytes = await file.arrayBuffer();
    return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    throw new PickedFileUnreadableError();
  }
}

export function materializePickedFiles(files: Iterable<File> | ArrayLike<File>): Promise<File[]> {
  return Promise.all(Array.from(files).map(materializePickedFile));
}
