import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const AGE_GROUPS = [
  "U5", "U6", "U7", "U8", "U9", "U10", "U11", "U12",
  "U13", "U14", "U15", "U16", "U17", "U18", "U19", "U21",
  "Senior", "Veterans", "Open Age",
  "Division 1", "Division 2", "Division 3", "Division 4",
  "Premier League", "Reserve Grade",
];

interface LevelAgeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function LevelAgeCombobox({ value, onChange, className }: LevelAgeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOptions = useMemo(() => {
    if (!searchQuery) return AGE_GROUPS;
    const q = searchQuery.toLowerCase();
    return AGE_GROUPS.filter((opt) => opt.toLowerCase().includes(q));
  }, [searchQuery]);

  const showCustomOption = searchQuery && !AGE_GROUPS.some(
    (opt) => opt.toLowerCase() === searchQuery.toLowerCase()
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal h-12 text-base bg-muted/50 border-muted-foreground/20 hover:bg-background transition-colors",
            !value && "text-muted-foreground",
            className
          )}
        >
          {value || "e.g., Under 12s, Division 2"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 max-h-[min(60dvh,var(--radix-popover-content-available-height))] overflow-hidden"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
      >
        <Command shouldFilter={false} className="max-h-full">
          <CommandInput
            placeholder="Search or type custom..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="max-h-[min(48dvh,320px)] overflow-y-auto overscroll-contain">
            <CommandEmpty>No matches found.</CommandEmpty>

            <CommandGroup>
              {showCustomOption && (
                <CommandItem
                  value={searchQuery}
                  onSelect={() => {
                    onChange(searchQuery);
                    setSearchQuery("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 opacity-0")} />
                  Use "{searchQuery}"
                </CommandItem>
              )}
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => {
                    onChange(option);
                    setSearchQuery("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
