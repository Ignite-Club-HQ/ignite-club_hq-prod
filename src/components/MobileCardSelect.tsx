import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface Option {
  value: string;
  label: string;
}

interface MobileCardSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
}

export function MobileCardSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  label,
  disabled = false,
  required = false,
}: MobileCardSelectProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);

  const selectedOption = options.find((opt) => opt.value === value);

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          className={cn(
            "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
            "bg-card hover:bg-accent/50",
            value ? "border-primary" : "border-border",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex flex-col gap-0.5">
            {label && (
              <span className="text-xs text-muted-foreground font-medium">
                {label}
                {required && <span className="text-destructive ml-1">*</span>}
              </span>
            )}
            <span className={cn(
              "text-base font-medium",
              !selectedOption && "text-muted-foreground"
            )}>
              {selectedOption?.label || placeholder}
            </span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>

        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>{label || "Select"}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-8 space-y-2 max-h-[60vh] overflow-y-auto">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                    "hover:bg-accent/50",
                    value === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card"
                  )}
                >
                  <span className="text-base font-medium">{option.label}</span>
                  {value === option.value && (
                    <Check className="h-5 w-5 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  // Desktop: Use standard Select
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-full h-12 text-base">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className="max-h-[40vh] w-[var(--radix-select-trigger-width)] min-w-[200px]"
        position="popper"
        sideOffset={4}
        align="start"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="py-3 text-base cursor-pointer"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
