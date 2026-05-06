import { useState, useRef, useEffect } from "react";
import { ImagePlus, X, Loader2, CalendarPlus, BarChart3, Plus, Play, Trophy, Paperclip, Upload, FolderOpen } from "lucide-react";
import { VaultPickerSheet } from "./VaultPickerSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { makeVaultFileToken, makeVaultFolderToken, makeVaultRootToken } from "@/lib/chatVaultLinks";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { compressImage as compressImageFile } from "@/lib/imageCompression";
import { mimeToExtension } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import { isIOSEnvironment, scheduleIOSNativeOverlayRecovery, temporarilyReleaseBodyScrollLock } from "@/lib/iosNativeOverlayRecovery";
import {
  isVideoFile,
  isVideoUrl,
  validateVideo,
  videoMimeToExtension,
  MAX_VIDEO_SIZE_BYTES,
} from "@/lib/videoUtils";

interface ChatImageInputProps {
  onImageUploaded: (imageUrl: string | null) => void;
  imageUrl: string | null;
  disabled?: boolean;
  clubId?: string;
  teamId?: string;
  onEventSelect?: (eventId: string) => void;
  showEventPicker?: boolean;
  onPollCreate?: () => void;
  showPollCreator?: boolean;
  /** Open the live-board picker (active games on user's teams). */
  onBoardPick?: () => void;
  showBoardPicker?: boolean;
  /** When true, the action icons are hidden and only the image preview (if any) is shown */
  hasText?: boolean;
  /** Append a token to the message (e.g. [vault:uuid]) when user shares from vault. */
  onAppendToken?: (token: string) => void;
  /** Show the "From Vault" / "Upload File" actions. Requires clubId. */
  showVaultPicker?: boolean;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const IOS_SAFE_COMPRESSION_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function ChatImageInput({ onImageUploaded, imageUrl, disabled, clubId, teamId, onEventSelect, showEventPicker = false, onPollCreate, showPollCreator = false, onBoardPick, showBoardPicker = false, hasText = false, onAppendToken, showVaultPicker = false }: ChatImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [attachChooserOpen, setAttachChooserOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const hadAttachmentRef = useRef(false);
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  const shouldStabilizeIOSLayout = isIOSEnvironment();
  const { user } = useAuth();

  // Fetch club sport so the live-board action subtitle is contextual.
  const { data: clubSport } = useQuery({
    queryKey: ["club-sport", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data } = await supabase.from("clubs").select("sport").eq("id", clubId).maybeSingle();
      return (data?.sport ?? null) as string | null;
    },
    enabled: !!clubId && showBoardPicker,
    staleTime: 5 * 60 * 1000,
  });

  // Only show the Share Live Board action when the user has access to at
  // least one active game on a team they belong to. Mirrors BoardPickerSheet's
  // `teams!inner` filter so an orphaned active_game owned by the user (no
  // team membership) doesn't surface the action.
  const { data: hasActiveBoard = false } = useQuery({
    queryKey: ["chat-has-active-board", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { count, error } = await supabase
        .from("active_games")
        .select("id, teams!inner(id)", { count: "exact", head: true })
        .eq("is_active", true);
      if (error) {
        console.error("[ChatImageInput] active board count failed", error);
        return false;
      }
      return (count ?? 0) > 0;
    },
    enabled: !!user?.id && showBoardPicker,
    staleTime: 30 * 1000,
    refetchInterval: menuOpen ? 15 * 1000 : false,
  });

  const canShowBoardPicker = showBoardPicker && hasActiveBoard;

  const boardSubtitle = (() => {
    const s = (clubSport || "").toLowerCase();
    if (s.includes("soccer") || s.includes("football")) return "Track your soccer match live";
    if (s.includes("netball")) return "Track your netball match live";
    if (s.includes("basketball")) return "Track your basketball game live";
    if (s.includes("hockey")) return "Track your hockey match live";
    if (s.includes("rugby")) return "Track your rugby match live";
    if (s) return `Track your ${clubSport} match live`;
    return "Soccer, netball or basketball";
  })();

  const dismissIOSKeyboardAccessory = () => {
    if (!isNativeIOS) return;
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const restoreNativeLayout = () => {
    if (!shouldStabilizeIOSLayout) return;
    recoveryCleanupRef.current?.();
    recoveryCleanupRef.current = scheduleIOSNativeOverlayRecovery();
  };

  const uploadBlob = async (
    blob: Blob,
    options?: { skipCompression?: boolean; isVideo?: boolean; fileName?: string },
  ) => {
    const { skipCompression = false, isVideo = false } = options ?? {};

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const originalMimeType = blob.type || (isVideo ? "video/mp4" : "image/jpeg");
    let fileToUpload: Blob | File = blob;
    let contentType = originalMimeType;

    if (!isVideo && !skipCompression) {
      const sourceFile = blob instanceof File
        ? blob
        : new File([blob], `photo.${mimeToExtension(originalMimeType)}`, { type: originalMimeType });

      try {
        const { file: compressedFile } = await compressImageFile(sourceFile);
        fileToUpload = compressedFile;
        contentType = compressedFile.type || originalMimeType || "image/jpeg";
      } catch (compressionError) {
        console.warn("[ChatImageInput] Compression failed, uploading original file:", compressionError);
        fileToUpload = sourceFile;
        contentType = sourceFile.type || originalMimeType || "image/jpeg";
      }
    }

    const extension = isVideo
      ? videoMimeToExtension(contentType)
      : mimeToExtension(contentType);

    const timestamp = Date.now();
    let fileName: string;
    if (teamId && clubId) {
      fileName = `clubs/${clubId}/teams/${teamId}/${user.id}/${timestamp}.${extension}`;
    } else if (clubId) {
      fileName = `clubs/${clubId}/${user.id}/${timestamp}.${extension}`;
    } else {
      fileName = `general/${user.id}/${timestamp}.${extension}`;
    }

    const { error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .upload(fileName, fileToUpload, { contentType, upsert: false });

    if (uploadError) throw new Error(uploadError.message || "Failed to upload image");

    const { data } = supabase.storage.from("chat-attachments").getPublicUrl(fileName);
    return data.publicUrl;
  };

  // Upload a non-image document file to chat-attachments and create a vault_files row,
  // then append a [vault:<id>] token to the message via onAppendToken.
  const handleDocumentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.error("File must be less than 10MB");
      if (docInputRef.current) docInputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not authenticated");

      const timestamp = Date.now();
      const safeExt = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      let path: string;
      if (teamId && clubId) {
        path = `clubs/${clubId}/teams/${teamId}/${authUser.id}/${timestamp}.${safeExt}`;
      } else if (clubId) {
        path = `clubs/${clubId}/${authUser.id}/${timestamp}.${safeExt}`;
      } else {
        path = `general/${authUser.id}/${timestamp}.${safeExt}`;
      }

      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
      const fileUrl = pub.publicUrl;

      // If we have club context, create vault_files row immediately so the file card is shareable.
      if (clubId && onAppendToken) {
        const { data: row, error: insErr } = await supabase
          .from("vault_files")
          .insert({
            club_id: clubId,
            team_id: teamId || null,
            uploaded_by: authUser.id,
            name: file.name,
            file_url: fileUrl,
            file_type: file.type || null,
            file_size: file.size,
            is_external_link: false,
          })
          .select("id")
          .single();
        if (insErr || !row) throw insErr || new Error("Failed to register file");
        onAppendToken(makeVaultFileToken(row.id));
        toast.success("File attached");
      } else {
        toast.error("Cannot attach file in this chat");
      }
    } catch (err) {
      console.error("[ChatImageInput] document upload failed", err);
      toast.error(getReadableUploadError(err) || "Failed to upload file");
    } finally {
      setUploading(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const handleVaultPick = (
    item:
      | { kind: "file" | "folder"; id: string; name: string }
      | { kind: "root"; scope: "team" | "club"; id: string; name: string },
  ) => {
    if (!onAppendToken) return;
    let token: string;
    if (item.kind === "file") {
      token = makeVaultFileToken(item.id);
    } else if (item.kind === "folder") {
      token = makeVaultFolderToken(item.id);
    } else if (item.kind === "root") {
      token = makeVaultRootToken(item.scope, item.id);
    } else {
      return;
    }
    onAppendToken(token);
    setVaultPickerOpen(false);
    if (item.kind === "root") {
      toast.success(`Shared entire ${item.scope === "team" ? "team" : "club"} vault`);
    } else {
      toast.success(`Shared "${item.name}"`);
    }
  };

  const handleVaultPickMany = (
    items: Array<
      | { kind: "file" | "folder"; id: string; name: string }
      | { kind: "root"; scope: "team" | "club"; id: string; name: string }
    >,
  ) => {
    if (!onAppendToken || items.length === 0) return;
    for (const item of items) {
      let token: string;
      if (item.kind === "file") token = makeVaultFileToken(item.id);
      else if (item.kind === "folder") token = makeVaultFolderToken(item.id);
      else if (item.kind === "root") token = makeVaultRootToken(item.scope, item.id);
      else continue;
      onAppendToken(token);
    }
    setVaultPickerOpen(false);
    toast.success(`Shared ${items.length} ${items.length === 1 ? "item" : "items"}`);
  };

  const handleNativePhotoPick = async () => {
    console.log("[ChatImageInput] handleNativePhotoPick START");
    let stablePreviewUrl: string | null = null;
    const restoreBodyScrollLock = temporarilyReleaseBodyScrollLock();

    try {
      const result = await pickNativePhoto({ quality: 80 });
      console.log("[ChatImageInput] pickNativePhoto OK, blob size:", result.blob.size, "mime:", result.mimeType);

      requestAnimationFrame(() => {
        restoreNativeLayout();
      });

      setUploading(true);

      const { blob, mimeType } = result;

      if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error("Image must be less than 10MB");
      }

      // Use a data URL for the native preview — blob: URLs are unreliable in
      // Capacitor WebView (especially Android) and sometimes fail to render.
      try {
        stablePreviewUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error || new Error("Preview read failed"));
          reader.readAsDataURL(blob);
        });
      } catch (previewErr) {
        console.warn("[ChatImageInput] data URL preview failed, falling back to blob URL", previewErr);
        stablePreviewUrl = URL.createObjectURL(blob);
      }
      dismissIOSKeyboardAccessory();
      setLocalPreview(stablePreviewUrl);
      requestAnimationFrame(restoreNativeLayout);

      const skipCompression = !IOS_SAFE_COMPRESSION_MIME_TYPES.has(mimeType);
      let storageUrl: string;

      try {
        storageUrl = await uploadBlob(blob, { skipCompression });
      } catch (primaryUploadError) {
        if (!skipCompression) {
          console.warn("[ChatImageInput] Retrying native upload without compression:", primaryUploadError);
          storageUrl = await uploadBlob(blob, { skipCompression: true });
        } else {
          throw primaryUploadError;
        }
      }
      console.log("[ChatImageInput] upload complete:", storageUrl.substring(0, 80));
      setLocalPreview(null);
      onImageUploaded(storageUrl);
    } catch (error: unknown) {
      if (isCancelledSelectionError(error)) {
        console.log("[ChatImageInput] user cancelled photo selection");
      } else {
        const errMsg = getReadableUploadError(error);
        console.error("[ChatImageInput] Image upload failed:", errMsg, error);
        toast.error(errMsg || "Failed to upload image");
      }
      setLocalPreview(null);
    } finally {
      if (stablePreviewUrl && stablePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(stablePreviewUrl);
      }
      restoreBodyScrollLock();
      restoreNativeLayout();
      setUploading(false);
      (document.activeElement as HTMLElement | null)?.blur();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = isVideoFile(file);

    if (!isVideo && !file.type.startsWith("image/")) {
      toast.error("Please select an image or video file");
      return;
    }

    if (isVideo) {
      const validation = await validateVideo(file);
      if (!validation.ok) {
        toast.error(validation.reason || "Video is not valid");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    } else if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.error("Image must be less than 10MB");
      return;
    }

    if (shouldStabilizeIOSLayout) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    const localUrl = URL.createObjectURL(file);
    setLocalPreview(localUrl);
    setUploading(true);

    try {
      const storageUrl = await uploadBlob(file, { isVideo });
      URL.revokeObjectURL(localUrl);
      setLocalPreview(null);
      onImageUploaded(storageUrl);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(isVideo ? "Failed to upload video" : "Failed to upload image");
      URL.revokeObjectURL(localUrl);
      setLocalPreview(null);
    } finally {
      setUploading(false);
      if (shouldStabilizeIOSLayout) {
        restoreNativeLayout();
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImageButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (shouldUseNativePicker()) {
      // CRITICAL iOS GESTURE RULE:
      // Camera.getPhoto must be invoked synchronously from the user's click —
      // any `await` or async hop before it breaks the gesture chain in WKWebView
      // and the picker silently fails to open. Do NOT add awaits or state
      // updates before this call. handleNativePhotoPick starts the async work
      // immediately on its first line so the gesture is preserved.
      void handleNativePhotoPick();
    } else {
      (e.currentTarget as HTMLElement)?.blur();
      fileInputRef.current?.click();
      if (shouldStabilizeIOSLayout) {
        requestAnimationFrame(() => {
          restoreNativeLayout();
        });
      }
    }
  };

  const handleRemoveImage = () => {
    if (localPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview(null);
    onImageUploaded(null);
    restoreNativeLayout();
  };

  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [localPreview, imageUrl]);

  useEffect(() => {
    return () => {
      recoveryCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const hasAttachment = Boolean(localPreview || imageUrl);

    if (shouldStabilizeIOSLayout && hadAttachmentRef.current && !hasAttachment && !uploading) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    hadAttachmentRef.current = hasAttachment;
  }, [imageUrl, localPreview, shouldStabilizeIOSLayout, uploading]);

  const displayUrl = localPreview || imageUrl;

  // If there's an image attached, always show the preview regardless of hasText
  if (displayUrl) {
    return (
      <div className="flex shrink-0 items-center gap-2 self-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileSelect}
          className="sr-only"
          disabled={disabled || uploading}
        />
        <div className="relative inline-block">
          {previewFailed ? (
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : isVideoUrl(displayUrl) ? (
            <div className="relative h-10 w-10 rounded overflow-hidden bg-black">
              <video
                src={displayUrl}
                className="h-10 w-10 object-cover"
                muted
                playsInline
                preload="metadata"
                onError={() => setPreviewFailed(true)}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                <Play className="h-3.5 w-3.5 fill-white text-white" />
              </div>
            </div>
          ) : (
            <img
              src={displayUrl}
              alt="Attachment preview"
              className="h-10 w-10 object-cover rounded"
              onError={() => setPreviewFailed(true)}
            />
          )}
          {uploading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          )}
          <button
            type="button"
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm"
            onClick={handleRemoveImage}
            disabled={disabled}
            aria-label="Remove attachment"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    );
  }

  // Hide action icons when user is typing
  if (hasText) {
    return (
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
    );
  }

  // Show photo button inline; event + poll behind a "+" popover.
  // Photo upload is ALWAYS mirrored inside the "+" popover because many users
  // (e.g. parents coming from WhatsApp/Messenger) instinctively look for
  // attachments behind a "+" rather than tapping the dedicated image icon.
  // The "+" button is therefore shown unconditionally, even when there are no
  // event/poll/board extras to surface.

  return (
    <div className="flex shrink-0 items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.zip,.odt,.ods,.odp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/plain,application/zip"
        onChange={handleDocumentSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
      {showVaultPicker && clubId && (
        <>
          <VaultPickerSheet
            open={vaultPickerOpen}
            onOpenChange={setVaultPickerOpen}
            clubId={clubId}
            teamId={teamId || null}
            onPick={handleVaultPick}
            onPickMany={handleVaultPickMany}
          />
          <Sheet open={attachChooserOpen} onOpenChange={setAttachChooserOpen}>
            <SheetContent side="bottom" className="p-0">
              <SheetHeader className="px-4 py-3 border-b border-border">
                <SheetTitle className="text-left text-base">Attach File or Folder</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-2 gap-3 p-4">
                <button
                  type="button"
                  disabled={disabled || uploading}
                  onClick={() => {
                    setAttachChooserOpen(false);
                    docInputRef.current?.click();
                  }}
                  className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border border-border bg-card hover:bg-accent active:bg-accent/80 transition-colors disabled:opacity-50 min-h-[120px]"
                  aria-label="Upload from device"
                >
                  <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-sm font-medium text-foreground">From Device</span>
                    <span className="text-[11px] text-muted-foreground">PDF, doc, sheet</span>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setAttachChooserOpen(false);
                    setVaultPickerOpen(true);
                  }}
                  className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border border-border bg-card hover:bg-accent active:bg-accent/80 transition-colors disabled:opacity-50 min-h-[120px]"
                  aria-label="Choose from vault"
                >
                  <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-sm font-medium text-foreground">From Vault</span>
                    <span className="text-[11px] text-muted-foreground">Existing file or folder</span>
                  </div>
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
      {/* Standalone image shortcut removed — photo upload lives inside the "+" menu. */}
      {(
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="More actions"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              // Prevent the textarea from blurring on press so the keyboard
              // does NOT dismiss when opening the attachment tray. The tray
              // should feel like an extension of the composer, not a modal
              // workflow that closes the keyboard.
              onPointerDown={(e) => {
                if (document.activeElement && document.activeElement !== e.currentTarget) {
                  e.preventDefault();
                }
              }}
              onMouseDown={(e) => {
                if (document.activeElement && document.activeElement !== e.currentTarget) {
                  e.preventDefault();
                }
              }}
              className={`inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-full transition-all duration-150 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                menuOpen
                  ? "bg-accent text-foreground"
                  : "text-foreground/60 hover:text-foreground hover:bg-accent active:bg-accent/80"
              }`}
            >
              <Plus
                className={`h-[18px] w-[18px] -mt-px transition-transform duration-200 ${menuOpen ? "rotate-45" : ""}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            sideOffset={10}
            collisionPadding={8}
            avoidCollisions={false}
            // Keep focus inside the composer textarea so the keyboard stays
            // up while the attachment tray is open.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="w-[calc(100vw-16px)] max-w-[420px] p-1.5 rounded-2xl border border-border/40 shadow-md bg-popover/92 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2 max-h-[min(70vh,420px)] overflow-y-auto overscroll-contain"
          >
            {(() => {
              type Action = {
                key: string;
                label: string;
                hint: string;
                icon: React.ReactNode;
                tone: "primary" | "muted";
                onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
                disabled?: boolean;
              };
              const actions: Action[] = [];
              actions.push({
                key: "photo",
                label: "Photo / Video",
                hint: "Camera roll",
                icon: <ImagePlus className="h-[20px] w-[20px]" strokeWidth={2} />,
                tone: "primary",
                disabled: disabled || uploading,
                onClick: (e) => {
                  setMenuOpen(false);
                  handleImageButtonClick(e);
                },
              });
              if (showVaultPicker && clubId) {
                actions.push({
                  key: "file",
                  label: "File or Folder",
                  hint: "Device or vault",
                  icon: <Paperclip className="h-[20px] w-[20px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled: disabled || uploading,
                  onClick: () => {
                    setMenuOpen(false);
                    setAttachChooserOpen(true);
                  },
                });
              }
              if (showEventPicker && onEventSelect) {
                actions.push({
                  key: "event",
                  label: "Share Event",
                  hint: "Training or game",
                  icon: <CalendarPlus className="h-[20px] w-[20px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: () => {
                    setMenuOpen(false);
                    onEventSelect("");
                  },
                });
              }
              if (showPollCreator && onPollCreate) {
                actions.push({
                  key: "poll",
                  label: "Create Poll",
                  hint: "Ask the group",
                  icon: <BarChart3 className="h-[20px] w-[20px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: () => {
                    setMenuOpen(false);
                    onPollCreate();
                  },
                });
              }
              if (canShowBoardPicker && onBoardPick) {
                actions.push({
                  key: "board",
                  label: "Live Board",
                  hint: "Track match live",
                  icon: <Trophy className="h-[20px] w-[20px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: () => {
                    setMenuOpen(false);
                    onBoardPick();
                  },
                });
              }
              return (
                <div className="grid grid-cols-2 gap-1.5">
                  {actions.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      disabled={a.disabled}
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={a.onClick}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-transparent hover:bg-muted/50 active:bg-muted/70 active:scale-[0.98] transition-all duration-100 disabled:opacity-50 disabled:active:scale-100 min-h-[52px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 text-left"
                      aria-label={a.label}
                    >
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-foreground/70"
                      >
                        {a.icon}
                      </div>
                      <div className="flex flex-col leading-tight min-w-0">
                        <span className="text-[13px] font-medium text-foreground/90 truncate">{a.label}</span>
                        <span className="text-[11px] text-muted-foreground/80 truncate">{a.hint}</span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
