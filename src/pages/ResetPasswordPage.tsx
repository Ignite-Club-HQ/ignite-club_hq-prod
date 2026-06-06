import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Lock, Loader2, CheckCircle, CheckCircle2, Circle, XCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const passwordRequirements = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "One uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), label: "One lowercase letter" },
  { test: (p: string) => /[0-9]/.test(p), label: "One number" },
];

const getPasswordStrengthMessage = (password: string): string | null => {
  const failed = passwordRequirements.filter(req => !req.test(password));
  if (failed.length === 0) return null;
  return `Password needs: ${failed.map(r => r.label.toLowerCase()).join(", ")}`;
};

const passwordSchema = z.object({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOtpRecovery, setShowOtpRecovery] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [breachedPasswords, setBreachedPasswords] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const establishRecoverySession = async () => {
      try {
        // Case 1: PKCE flow — Supabase puts ?code=... in the URL search params
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errorDescription =
          url.searchParams.get("error_description") ||
          new URLSearchParams(url.hash.replace(/^#/, "")).get("error_description");

        if (errorDescription) {
          if (!cancelled) setError(decodeURIComponent(errorDescription));
          return;
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error("[ResetPassword] exchangeCodeForSession error:", exchangeError);
            if (!cancelled) {
              setError("Invalid or expired reset link. Please request a new password reset.");
            }
            return;
          }
          // Clean the URL so a refresh doesn't try to re-exchange the code
          window.history.replaceState({}, document.title, "/reset-password");
        }

        // Case 2: implicit/hash flow — Supabase auto-detects via detectSessionInUrl.
        // Give the SDK a brief window to process tokens in the URL hash before
        // we conclude there's no session (avoids a flash of the error UI).
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (cancelled) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session && !cancelled) {
          setError("Invalid or expired reset link. Please request a new password reset.");
        }
      } catch (err) {
        console.error("[ResetPassword] session setup failed:", err);
        if (!cancelled) {
          setError("Invalid or expired reset link. Please request a new password reset.");
        }
      }
    };

    establishRecoverySession();

    // Also listen for PASSWORD_RECOVERY in case the SDK fires it after our check
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) {
        setError(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const sendRecoveryCode = async () => {
    const validation = emailSchema.safeParse(otpEmail);
    if (!validation.success) {
      toast({
        title: "Invalid email",
        description: validation.error.errors[0].message,
      });
      return;
    }
    setSendingOtp(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(otpEmail, {
      redirectTo: getPasswordResetRedirectUrl(otpEmail),
    });
    setSendingOtp(false);
    if (sendError) {
      console.error("[ResetPassword] resetPasswordForEmail error:", sendError);
    }
    toast({
      title: "Code sent",
      description: "Check your email for a 6-digit code.",
    });
  };

  const verifyRecoveryCode = async (token: string) => {
    setVerifyingOtp(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: otpEmail,
      token,
      type: "recovery",
    });
    setVerifyingOtp(false);
    if (verifyError) {
      toast({
        title: "Invalid or expired code",
        description: "Double-check the code or request a new one.",
      });
      setOtpCode("");
      return;
    }
    // Now in a recovery session — clear the error to show password form
    setError(null);
    setShowOtpRecovery(false);
    setOtpCode("");
  };

  const handleOtpChange = (value: string) => {
    setOtpCode(value);
    if (value.length === 6 && !verifyingOtp) {
      void verifyRecoveryCode(value);
    }
  };

  const handleResetPassword = async () => {
    const validation = passwordSchema.safeParse({ password, confirmPassword });
    if (!validation.success) {
      const strengthMessage = getPasswordStrengthMessage(password);
      toast({
        title: "Please check your password",
        description: strengthMessage || validation.error.errors[0].message,
      });
      return;
    }

    setLoading(true);
    
    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    setLoading(false);

    if (error) {
      const msg = error.message || "";
      const isWeak = /weak|pwned|breach|compromis|easy to guess/i.test(msg);
      if (isWeak) {
        setBreachedPasswords((prev) => new Set(prev).add(password));
      }
      toast({
        title: isWeak ? "Password too common" : "Unable to reset password",
        description: isWeak
          ? "This password has appeared in known data breaches. Please choose a different, more unique password (e.g. add extra words or symbols)."
          : msg,
      });
    } else {
      setSuccess(true);
      toast({
        title: "Password updated!",
        description: "Your password has been reset successfully.",
      });
      // Redirect to home after a short delay
      setTimeout(() => navigate("/"), 2000);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-2xl bg-primary glow-emerald">
              <Flame className="h-10 w-10 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          </div>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            {!showOtpRecovery ? (
              <CardContent className="pt-6 text-center space-y-4">
                <p className="text-muted-foreground">{error}</p>
                <p className="text-xs text-muted-foreground">
                  Email link scanners sometimes consume reset links before you click them.
                  Use a 6-digit code instead — it can't be triggered by scanners.
                </p>
                <Button
                  onClick={() => setShowOtpRecovery(true)}
                  className="w-full"
                >
                  Use a 6-digit code instead
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/auth")}
                  className="w-full"
                >
                  Back to Sign In
                </Button>
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>Reset with a code</CardTitle>
                  <CardDescription>
                    We'll email you a 6-digit code. Enter it below to reset your password.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="otp-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="otp-email"
                        type="email"
                        placeholder="you@example.com"
                        className="pl-10"
                        value={otpEmail}
                        onChange={(e) => setOtpEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={sendRecoveryCode}
                    disabled={sendingOtp}
                    className="w-full"
                    variant="outline"
                  >
                    {sendingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send code"}
                  </Button>

                  <div className="flex flex-col items-center gap-3 pt-2">
                    <Label className="text-sm">Enter the 6-digit code</Label>
                    <InputOTP
                      maxLength={6}
                      value={otpCode}
                      onChange={handleOtpChange}
                      disabled={verifyingOtp}
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
                    {verifyingOtp && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying…
                      </div>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowOtpRecovery(false);
                      setOtpCode("");
                    }}
                    className="w-full"
                  >
                    Back
                  </Button>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-2xl bg-primary glow-emerald">
              <Flame className="h-10 w-10 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          </div>
          
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="pt-6 text-center space-y-4">
              <CheckCircle className="h-12 w-12 text-primary mx-auto" />
              <p className="text-foreground font-medium">Password reset successful!</p>
              <p className="text-sm text-muted-foreground">Redirecting you to the app...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md space-y-8 animate-slide-up">
        <div className="flex flex-col items-center gap-3">
          <div className="p-4 rounded-2xl bg-primary glow-emerald">
            <Flame className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          <p className="text-sm font-medium text-muted-foreground">Club HQ</p>
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Reset Your Password</CardTitle>
            <CardDescription>
              Enter your new password below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {password && (
                <div className="space-y-1 mt-2">
                  {passwordRequirements.map((req, idx) => {
                    const met = req.test(password);
                    return (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        {met
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                        }
                        <span className={met ? 'text-primary' : 'text-muted-foreground'}>
                          {req.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <Button 
              className="w-full" 
              onClick={handleResetPassword}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset Password"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
