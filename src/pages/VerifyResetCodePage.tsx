import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, ShieldCheck } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";

const emailSchema = z.string().email("Please enter a valid email address");

export default function VerifyResetCodePage() {
  usePageTitle("Verify Reset Code");

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  // If both email and code are provided in the URL, attempt verification automatically.
  useEffect(() => {
    const urlCode = searchParams.get("code");
    const urlEmail = searchParams.get("email");
    if (urlEmail && urlCode && urlCode.length === 6 && /^\d{6}$/.test(urlCode)) {
      setEmail(urlEmail);
      setCode(urlCode);
      void verifyCode(urlEmail, urlCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyCode = async (emailValue: string, token: string) => {
    const validation = emailSchema.safeParse(emailValue);
    if (!validation.success) {
      toast({
        title: "Invalid email",
        description: validation.error.errors[0].message,
      });
      return;
    }

    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({
      email: emailValue,
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
    navigate("/reset-password");
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (value.length === 6 && !verifying) {
      void verifyCode(email, value);
    }
  };

  const resendCode = async () => {
    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      toast({
        title: "Invalid email",
        description: validation.error.errors[0].message,
      });
      return;
    }

    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setResending(false);

    if (error) {
      console.error("[VerifyResetCode] resetPasswordForEmail error:", error);
    }

    // Always show success to avoid email enumeration.
    toast({
      title: "Code sent",
      description: "Check your email for a 6-digit code.",
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="p-3 rounded-full bg-primary/10">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Enter your reset code
            </h1>
            <p className="text-sm text-muted-foreground">
              Already have a 6-digit code from your email? Enter it below to
              continue resetting your password.
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-5 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="verify-email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="verify-email"
                type="email"
                placeholder="you@example.com"
                className="pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={verifying}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>6-digit code</Label>
            <div className="flex justify-center pt-1">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={handleCodeChange}
                disabled={verifying}
                autoFocus={!!email}
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
            </div>
            {verifying && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resendCode}
              disabled={resending || verifying}
            >
              {resending ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Sending…
                </>
              ) : (
                "Resend code to this email"
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Codes expire 1 hour after they're sent. Check your spam folder if
              it doesn't arrive.
            </p>
          </div>
        </div>

        <div className="flex justify-center">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/auth">
              <ArrowLeft className="h-3 w-3 mr-1" />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
