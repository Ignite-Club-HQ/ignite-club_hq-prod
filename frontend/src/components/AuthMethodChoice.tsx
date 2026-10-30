import { Fingerprint, Mail } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AuthMethodChoiceProps {
  value: "supabase" | "icp";
  onChange: (value: "supabase" | "icp") => void;
  disabled?: boolean;
}

/** Method tabs live above the open form; there is no separate picker screen. */
export function AuthMethodChoice({ value, onChange, disabled }: AuthMethodChoiceProps) {
  return (
    <Tabs value={value} onValueChange={next => {
      if (next === "supabase" || next === "icp") onChange(next);
    }}>
      <TabsList className="grid h-12 w-full grid-cols-2" aria-label="Sign-in method">
        <TabsTrigger value="supabase" disabled={disabled} className="h-full min-w-0 gap-2 px-2 whitespace-normal leading-tight">
          <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />Sign in with email
        </TabsTrigger>
        <TabsTrigger value="icp" disabled={disabled} className="h-full min-w-0 gap-2 px-2 whitespace-normal leading-tight">
          <Fingerprint className="h-4 w-4 shrink-0" aria-hidden="true" />Sign in securely
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
