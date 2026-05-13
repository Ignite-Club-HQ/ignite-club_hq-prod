import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Loader2, CheckCircle, ArrowLeft } from "lucide-react";
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            {step === "email"
              ? "Enter your email and we'll send you a 6-digit code to reset your password."
              : `Enter the 6-digit code we sent to ${email}.`}
          </DialogDescription>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button onClick={() => sendCode()} disabled={sending} className="flex-1">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Code"}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep("code")}
              className="w-full text-muted-foreground"
            >
              I already have a code
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border/50">
              Already signed in? You can change your password from{" "}
              <span className="font-medium text-foreground">Settings → Change Password</span>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center py-4 space-y-5">
            <div className="p-3 rounded-full bg-primary/10">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-medium">Check your email</p>
              <p className="text-sm text-muted-foreground">
                We sent a 6-digit code. It expires in 1 hour.
              </p>
            </div>

            <InputOTP
              maxLength={6}
              value={code}
              onChange={handleCodeChange}
              disabled={verifying}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>

            {verifying && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </div>
            )}

            <div className="flex flex-col items-center gap-2 w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => sendCode(true)}
                disabled={sending || resendCooldown > 0}
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
                className="text-muted-foreground"
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
      </DialogContent>
    </Dialog>
  );
}
