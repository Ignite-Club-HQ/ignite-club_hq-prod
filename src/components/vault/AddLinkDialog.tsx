import { useState } from "react";
import { Link2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddLink: (url: string, name: string) => void;
  isAdding?: boolean;
  targetName: string;
}

// Helper to detect link type from URL
function detectLinkType(url: string): { type: string; icon: string; color: string } {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('docs.google.com/document')) {
    return { type: 'Google Doc', icon: '📄', color: 'text-blue-600' };
  }
  if (lowerUrl.includes('docs.google.com/spreadsheets')) {
    return { type: 'Google Sheet', icon: '📊', color: 'text-green-600' };
  }
  if (lowerUrl.includes('docs.google.com/presentation')) {
    return { type: 'Google Slides', icon: '📽️', color: 'text-yellow-600' };
  }
  if (lowerUrl.includes('drive.google.com')) {
    return { type: 'Google Drive', icon: '📁', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('dropbox.com')) {
    return { type: 'Dropbox', icon: '📦', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('notion.so') || lowerUrl.includes('notion.site')) {
    return { type: 'Notion', icon: '📝', color: 'text-gray-800' };
  }
  if (lowerUrl.includes('onedrive.live.com') || lowerUrl.includes('sharepoint.com')) {
    return { type: 'OneDrive', icon: '☁️', color: 'text-blue-600' };
  }
  
  return { type: 'External Link', icon: '🔗', color: 'text-muted-foreground' };
}

// Helper to extract a suggested name from URL
function suggestNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // For Google Docs, try to extract title from path
    if (url.includes('docs.google.com/document')) {
      // Google Docs URLs often have /d/{id}/edit - we can't extract title from URL
      return 'Google Doc';
    }
    if (url.includes('docs.google.com/spreadsheets')) {
      return 'Google Sheet';
    }
    if (url.includes('docs.google.com/presentation')) {
      return 'Google Slides';
    }
    
    // For other URLs, try to get something meaningful
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && !lastPart.match(/^[a-zA-Z0-9_-]{25,}$/)) {
      // If it's not just a random ID, use it as name
      return decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
    }
    
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'External Link';
  }
}

// Validate URL
function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    // Try adding https:// prefix
    try {
      const urlObj = new URL(`https://${url}`);
      return urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }
}

export function AddLinkDialog({
  open,
  onOpenChange,
  onAddLink,
  isAdding = false,
  targetName,
}: AddLinkDialogProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);

  // Normalize URL (add https:// if missing)
  const normalizeUrl = (inputUrl: string): string => {
    if (!inputUrl) return "";
    if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://')) {
      return inputUrl;
    }
    return `https://${inputUrl}`;
  };

  const normalizedUrl = normalizeUrl(url);
  const isValid = url.length > 0 && isValidUrl(url);
  const linkInfo = isValid ? detectLinkType(normalizedUrl) : null;

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setUrlTouched(true);
    
    // Auto-suggest name if empty
    if (!name && isValidUrl(value)) {
      setName(suggestNameFromUrl(normalizeUrl(value)));
    }
  };

  const handleAddLink = () => {
    if (isValid && name.trim()) {
      onAddLink(normalizedUrl, name.trim());
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form
      setUrl("");
      setName("");
      setUrlTouched(false);
    }
    onOpenChange(newOpen);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Add Link to {targetName}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="link-url">Link URL</Label>
            <Input
              id="link-url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://docs.google.com/document/d/..."
              className={urlTouched && url && !isValid ? "border-destructive" : ""}
            />
            {urlTouched && url && !isValid && (
              <p className="text-xs text-destructive">Please enter a valid URL</p>
            )}
          </div>

          {isValid && linkInfo && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              <span className="text-xl">{linkInfo.icon}</span>
              <div className="flex-1">
                <p className={`text-sm font-medium ${linkInfo.color}`}>{linkInfo.type}</p>
                <p className="text-xs text-muted-foreground truncate">{normalizedUrl}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="link-name">Display Name</Label>
            <Input
              id="link-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Document"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            💡 Tip: Add links to Google Docs, Sheets, or other cloud documents. 
            Clicking the link will open the live document for editing.
          </p>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddLink}
            disabled={!isValid || !name.trim() || isAdding}
            className="flex-1 sm:flex-none"
          >
            {isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                Add Link
              </>
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
