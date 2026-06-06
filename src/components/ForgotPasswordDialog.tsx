import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Loader2, CheckCircle, ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getPasswordResetRedirectUrl } from "@/lib/passwordResetRedirect";
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

    // No redirectTo — we want the email's OTP code, not a magic link click.
    // The recovery email template in Supabase must include {{ .Token }}.
    // redirectTo points to /verify-reset-code so users who DO click the
    // email link land on the OTP entry page (where they can paste the
    // 6-digit code from the same email). Cross-device users can also
    // navigate there directly via "I already have a code".
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(email),
    });

    setSending(false);

    if (error) {
      console.error("[ForgotPassword] resetPasswordForEmail error:", error);
    }

    // Always advance to the code step regardless of error to avoid email
    // enumeration. If the email isn't registered, the code simply won't verify.
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

    // verifyOtp puts the user in a recovery session — ResetPasswordPage
    // detects the session and shows the new-password form.
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
    // Reset state after dialog closes
    setTimeout(() => {
      setStep("email");
      setCode("");
      setResendCooldown(0);
      if (!defaultEmail) setEmail("");
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-0 gap-0 overflow-hidden rounded-2xl sm:rounded-xl max-h-[calc(100dvh-2rem)] flex flex-col">
        <div className="px-4 pt-5 pb-3 sm:px-6 sm:pt-7 sm:pb-4 shrink-0">
          <div className="flex justify-center mb-2 sm:mb-3">
            <div className="p-2 sm:p-2.5 rounded-full bg-primary/10">
              {step === "email" ? (
                <KeyRound className="h-5 w-5 text-primary" />
              ) : (
                <CheckCircle className="h-5 w-5 text-primary" />
              )}
            </div>
          </div>
          <DialogHeader className="space-y-1 text-center sm:text-center">
            <DialogTitle className="text-base sm:text-xl">Reset Password</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm leading-relaxed">
              {step === "email"
                ? "Enter your email and we'll send you a 6-digit code."
                : (
                  <>We sent a 6-digit code to<br />
                    <span className="font-medium text-foreground break-all">{email}</span>
                  </>
                )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-4 pb-4 sm:px-6 sm:pb-6 overflow-y-auto flex-1 min-h-0">
          {step === "email" ? (
            <div className="space-y-3 sm:space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email" className="text-sm">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reset-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="you@example.com"
                    className="pl-10 h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button variant="outline" onClick={handleClose} className="flex-1 h-11">
                  Cancel
                </Button>
                <Button onClick={() => sendCode()} disabled={sending} className="flex-1 h-11">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Code"}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("code")}
                className="w-full text-muted-foreground h-9"
              >
                I already have a code
              </Button>
              <p className="text-[11px] sm:text-xs text-muted-foreground text-center pt-2 sm:pt-3 border-t border-border/50">
                Already signed in? Change your password from{" "}
                <span className="font-medium text-foreground">Settings → Change Password</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-code-email" className="text-sm">Email</Label>
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
                    className="pl-10 h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">6-digit code</Label>
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={handleCodeChange}
                  disabled={verifying}
                  autoFocus={!!email}
                  containerClassName="justify-center"
                  inputMode="numeric"
                >
                  <InputOTPGroup className="gap-1.5 sm:gap-2">
                    {[0,1,2,3,4,5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-11 w-9 sm:h-12 sm:w-11 text-base sm:text-lg rounded-md border"
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

              <div className="flex flex-col items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => sendCode(true)}
                  disabled={sending || resendCooldown > 0}
                  className="h-9"
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
                  className="text-muted-foreground h-9"
                >
                  <ArrowLeft className="h-3 w-3 mr-1" />
                  Use a different email
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Don't see the email? Check your spam folder.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
