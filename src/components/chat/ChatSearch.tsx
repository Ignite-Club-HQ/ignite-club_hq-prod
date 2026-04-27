import { useState, useEffect, useCallback, useRef } from "react";
import { Search, ArrowLeft, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/useDebounce";

interface ChatSearchProps {
  onSearch: (query: string) => void;
  debounceMs?: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChatSearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} className="h-8 w-8">
      <Search className="h-4 w-4" />
    </Button>
  );
}

export function ChatSearchBar({ onSearch, debounceMs = 300, isOpen, onOpenChange }: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, debounceMs);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  useEffect(() => {
    if (isOpen) {
      // Small delay to allow animation
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setQuery("");
    onOpenChange(false);
  }, [onOpenChange]);

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center gap-2 px-2 bg-background z-50 animate-in fade-in slide-in-from-right-4 duration-200">
      <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0 h-9 w-9">
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 pr-9 h-9 bg-muted/50 border-0 focus-visible:ring-1"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// Keep legacy component for backward compat if needed
export function ChatSearch({ onSearch, debounceMs = 300 }: { onSearch: (query: string) => void; debounceMs?: number }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      {!isOpen && <ChatSearchTrigger onClick={() => setIsOpen(true)} />}
      <ChatSearchBar onSearch={onSearch} debounceMs={debounceMs} isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;

  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Capture group so split keeps matches; case-insensitive
  const splitter = new RegExp(`(${escaped})`, "gi");
  const lower = query.trim().toLowerCase();
  const parts = text.split(splitter);

  return parts.map((part, i) =>
    part && part.toLowerCase() === lower ? (
      <mark
        key={i}
        className="rounded px-0.5 font-semibold"
        style={{ backgroundColor: "#fde047", color: "#1f2937" }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
