import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Loader2, CheckCircle, ArrowLeft, KeyRound, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getPasswordResetRedirectUrl } from "@/lib/passwordResetRedirect";
import { cn } from "@/lib/utils";
import { z } from "zod";

const emailSchema = z.string().email("Please enter a valid email address");

interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmail?: string;
}

type Step = "email" | "code";

export function ForgotPasswordDialog({ open, onOpenChange, defaultEmail = "" }: ForgotPasswordDialogProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [step, setStep] = useState<Step>("email");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { toast } = useToast();
  const navigate = useNavigate();
  const cooldownRef = useRef<number | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownRef.current = window.setTimeout(() => {
      setResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (cooldownRef.current) window.clearTimeout(cooldownRef.current);
    };
  }, [resendCooldown]);

  const sendCode = async (isResend = false) => {
    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      toast({
        title: "Invalid email",
        description: validation.error.errors[0].message,
      });
      return;
    }

    setSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(email),
    });
    setSending(false);

    if (error) {
      console.error("[ForgotPassword] resetPasswordForEmail error:", error);
    }

    setStep("code");
    setResendCooldown(45);

    if (isResend) {
      toast({
        title: "Code resent",
        description: "Check your email for a new 6-digit code.",
      });
    }
  };

  const verifyCode = async (token: string) => {
    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      toast({
        title: "Enter your email",
        description: "We need your email to verify the code.",
      });
      return;
    }
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "recovery",
    });
    setVerifying(false);

    if (error) {
      toast({
        title: "Invalid or expired code",
        description: "Double-check the code or request a new one.",
      });
      setCode("");
      return;
    }

    handleClose();
    navigate("/reset-password");
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (value.length === 6 && !verifying && emailSchema.safeParse(email).success) {
      void verifyCode(value);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("email");
      setCode("");
      setResendCooldown(0);
      if (!defaultEmail) setEmail("");
    }, 300);
  };

  const emailInputClasses = cn(
    "pl-10 h-12 bg-white text-foreground border transition-colors rounded-xl",
    "focus-visible:ring-0 focus-visible:ring-offset-0",
    emailFocused ? "border-primary ring-1 ring-primary" : "border-input",
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        enableDragToClose
        className="p-0 gap-0 rounded-t-3xl border-t-0 bg-background max-h-[calc(100dvh-3rem)] flex flex-col"
      >

        <div className="px-5 pt-3 pb-2 shrink-0">
          <div className="flex justify-center mb-3">
            <div className="p-2.5 rounded-full bg-primary/10">
              {step === "email" ? (
                <KeyRound className="h-5 w-5 text-primary" />
              ) : (
                <CheckCircle className="h-5 w-5 text-primary" />
              )}
            </div>
          </div>
          <SheetHeader className="space-y-1.5 text-center sm:text-center">
            <SheetTitle className="text-xl font-semibold">Reset Password</SheetTitle>
            <SheetDescription className="text-sm leading-snug px-2">
              {step === "email"
                ? "Enter your email and we'll send you a 6-digit verification code."
                : (
                  <>We sent a code to<br />
                    <span className="font-medium text-foreground break-all">{email}</span>
                  </>
                )}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="px-5 pt-3 pb-5 overflow-y-auto flex-1 min-h-0">
          {step === "email" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email" className="text-xs font-medium text-muted-foreground">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reset-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="send"
                    placeholder="you@example.com"
                    className={emailInputClasses}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  />
                </div>
              </div>

              <Button
                onClick={() => sendCode()}
                disabled={sending}
                className="w-full h-[52px] rounded-xl text-base font-semibold"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Code"}
              </Button>

              <button
                type="button"
                onClick={() => setStep("code")}
                className="w-full flex flex-col items-center justify-center py-1.5 min-h-[44px] text-sm"
              >
                <span className="text-muted-foreground">Already received a code?</span>
                <span className="text-primary font-medium inline-flex items-center gap-1 mt-0.5">
                  Enter Code <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>

              <button
                type="button"
                onClick={handleClose}
                className="w-full text-sm text-muted-foreground py-2 min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reset-code-email" className="text-xs font-medium text-muted-foreground">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reset-code-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="you@example.com"
                    className={emailInputClasses}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">6-digit code</Label>
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={handleCodeChange}
                  disabled={verifying}
                  autoFocus={!!email}
                  containerClassName="justify-center"
                  inputMode="numeric"
                >
                  <InputOTPGroup className="gap-1.5">
                    {[0,1,2,3,4,5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 w-10 text-base rounded-md border"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {verifying && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </div>
              )}

              <div className="flex flex-col items-center gap-0.5 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => sendCode(true)}
                  disabled={sending || resendCooldown > 0}
                  className="h-10 text-sm"
                >
                  {resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : sending
                      ? "Sending…"
                      : "Resend code"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                  }}
                  className="text-muted-foreground h-10 text-sm"
                >
                  <ArrowLeft className="h-3 w-3 mr-1" />
                  Use a different email
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground text-center">
                Don't see the email? Check your spam folder.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
