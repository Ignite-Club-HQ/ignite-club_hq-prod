import { useState, useMemo, useEffect } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const JUNIOR_GROUPS = [
  "U5", "U6", "U7", "U8", "U9", "U10", "U11", "U12",
  "U13", "U14", "U15", "U16", "U17", "U18", "U19", "U21",
];

const SENIOR_GROUPS = [
  "Senior", "Veterans", "Open Age",
  "Division 1", "Division 2", "Division 3", "Division 4",
  "Premier League", "Reserve Grade",
];

type Category = "junior" | "senior" | "custom";

const CATEGORIES: { key: Category; label: string; hint: string }[] = [
  { key: "junior", label: "Junior", hint: "Age groups (U5 – U21)" },
  { key: "senior", label: "Senior", hint: "Grades and divisions" },
  { key: "custom", label: "Custom", hint: "Type your own label" },
];

function inferCategory(value: string): Category | null {
  if (!value) return null;
  if (JUNIOR_GROUPS.includes(value)) return "junior";
  if (SENIOR_GROUPS.includes(value)) return "senior";
  return "custom";
}

interface LevelAgeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function LevelAgeCombobox({ value, onChange, className }: LevelAgeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(() => inferCategory(value));

  // Adopt the category implied by an externally-loaded value (e.g. edit page hydration)
  useEffect(() => {
    if (!category && value) setCategory(inferCategory(value));
  }, [value, category]);

  const options = category === "junior" ? JUNIOR_GROUPS : category === "senior" ? SENIOR_GROUPS : [];

  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options;
    const q = searchQuery.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [searchQuery, options]);

  const showCustomOption = searchQuery && !options.some(
    (opt) => opt.toLowerCase() === searchQuery.toLowerCase()
  );

  const selectCategory = (next: Category) => {
    setCategory(next);
    setSearchQuery("");
    if (value && inferCategory(value) !== next) onChange("");
    if (next !== "custom") setOpen(true);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-3 gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => selectCategory(c.key)}
            aria-pressed={category === c.key}
            className={cn(
              "rounded-lg border px-2 py-2 text-sm font-medium transition-colors min-h-11",
              category === c.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-muted-foreground/20 bg-muted/50 text-muted-foreground hover:bg-background"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {!category && (
        <p className="text-xs text-muted-foreground">
          Choose Junior, Senior or Custom to see the available levels.
        </p>
      )}

      {category === "custom" && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g., Development Squad"
          className="h-12 text-base bg-muted/50 border-muted-foreground/20"
        />
      )}

      {(category === "junior" || category === "senior") && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between font-normal h-12 text-base bg-muted/50 border-muted-foreground/20 hover:bg-background transition-colors",
                !value && "text-muted-foreground"
              )}
            >
              <span className="truncate">
                {value || (category === "junior" ? "Select age group" : "Select grade / division")}
              </span>
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
      )}
    </div>
  );
}
