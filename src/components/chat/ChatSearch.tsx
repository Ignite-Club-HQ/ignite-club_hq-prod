import { useState, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/useDebounce";

interface ChatSearchProps {
  onSearch: (query: string) => void;
  debounceMs?: number;
}

export function ChatSearch({ onSearch, debounceMs = 300 }: ChatSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, debounceMs);

  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuery("");
  }, []);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  if (!isOpen) {
    return (
      <Button variant="ghost" size="icon" onClick={handleOpen}>
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search messages..."
          value={query}
          onChange={handleInputChange}
          className="pl-8 h-8"
          autoFocus
        />
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="bg-primary/30 text-inherit rounded px-0.5">{part}</mark>
    ) : part
  );
}
