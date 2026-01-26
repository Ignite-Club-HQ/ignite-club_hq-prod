import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Flame, Mail, Lock, Loader2, Eye, EyeOff, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { usePasskey, isPlatformAuthenticatorAvailable } from "@/hooks/usePasskey";
import { InviteFlowProgress, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";

import { z } from "zod";

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

const authSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signupPasswordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  
  // Check if we should default to signup view (new user from invite)
  const defaultView = sessionStorage.getItem("authDefaultTab") || "signin";
  const [authMode, setAuthMode] = useState<"signin" | "signup">(defaultView as "signin" | "signup");
  
  // Check if we're actively in an invite flow - only valid if there's a pending redirect
  const redirectAfterAuth = sessionStorage.getItem("redirectAfterAuth");
  const [inviteFlowContext, setInviteFlowContext] = useState(() => getInviteFlowContext());
  
  // Only show invite flow progress if there's an active context AND a pending redirect
  // This prevents stale contexts from showing on normal sign-in
  const isInInviteFlow = inviteFlowContext?.active === true && !!redirectAfterAuth;
  
  // Clear stale invite flow context and session storage on mount
  useEffect(() => {
    sessionStorage.removeItem("authDefaultTab");
    
    // If there's an invite flow context but no pending redirect, it's stale - clear it
    const currentContext = getInviteFlowContext();
    if (currentContext?.active && !redirectAfterAuth) {
      clearInviteFlowContext();
      setInviteFlowContext(null);
    }
    
    // Also clear any stale PWA pending invite if user is just signing in normally
    if (!redirectAfterAuth) {
      localStorage.removeItem("pwa_pending_invite");
    }
  }, [redirectAfterAuth]);
  
  const { toast } = useToast();
  const { user, signIn, signUp, signInWithGoogle, loading: authLoading } = useAuth();
  const { isAvailable, accounts, loading: passkeyLoading, authenticateWithPasskey } = usePasskey();
  
  // Check if biometrics are available (for showing the passkey button)
  useEffect(() => {
    const checkBiometrics = async () => {
      const available = await isPlatformAuthenticatorAvailable();
      setBiometricsAvailable(available);
    };
    checkBiometrics();
  }, []);
  


  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Checking authentication...</p>
      </div>
    );
  }

  if (user) {
    // Check for pending redirect (e.g., from invite link) before going to default
    const redirectPath = sessionStorage.getItem("redirectAfterAuth");
    if (redirectPath) {
      sessionStorage.removeItem("redirectAfterAuth");
      return <Navigate to={redirectPath} replace />;
    }
    // Default to home - clear any stale invite flow context since we're not in a flow
    clearInviteFlowContext();
    return <Navigate to="/" replace />;
  }

  const handleAuth = async (mode: "signin" | "signup") => {
    // For signin, use basic validation
    if (mode === "signin") {
      const validation = authSchema.safeParse({ email, password });
      if (!validation.success) {
        toast({
          title: "Please check your details",
          description: validation.error.errors[0].message,
        });
        return;
      }
    } else {
      // For signup, validate email first
      const emailValidation = z.string().email("Please enter a valid email").safeParse(email);
      if (!emailValidation.success) {
        toast({
          title: "Please check your email",
          description: emailValidation.error.errors[0].message,
        });
        return;
      }
      
      // Then validate password with stronger requirements
      const passwordValidation = signupPasswordSchema.safeParse(password);
      if (!passwordValidation.success) {
        const strengthMessage = getPasswordStrengthMessage(password);
        toast({
          title: "Password not strong enough",
          description: strengthMessage || passwordValidation.error.errors[0].message,
        });
        return;
      }
      
      if (password !== confirmPassword) {
        toast({
          title: "Passwords don't match",
          description: "Please ensure both passwords are identical.",
        });
        return;
      }
    }

    setLoading(true);
    const { error } = mode === "signin" 
      ? await signIn(email, password)
      : await signUp(email, password);
    
    setLoading(false);

    if (error) {
      let message = error.message;
      let title = "Something went wrong";
      if (message.includes("already registered")) {
        title = "Account exists";
        message = "This email is already registered. Please sign in instead.";
      } else if (message.includes("Invalid login")) {
        title = "Unable to sign in";
        message = "Invalid email or password. Please try again.";
      } else if (message.includes("Email not confirmed")) {
        title = "Email not verified";
        message = "Please check your inbox and verify your email.";
      } else if (message.includes("Network") || message.includes("fetch")) {
        title = "Connection issue";
        message = "Please check your internet connection and try again.";
      }
      toast({
        title,
        description: message,
      });
    } else if (mode === "signup") {
      toast({
        title: "Welcome to Ignite Club HQ!",
        description: "Your account has been created successfully.",
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    setGoogleLoading(false);
    
    if (error) {
      let message = error.message;
      if (message.includes("Network") || message.includes("fetch")) {
        message = "Please check your internet connection and try again.";
      }
      toast({
        title: "Unable to sign in with Google",
        description: message,
      });
    }
  };

  const handleBiometricSignIn = async () => {
    // Always use discoverable credentials - let the browser show ALL available passkeys
    console.log('[AuthPage] handleBiometricSignIn - using discoverable credentials');
    const result = await authenticateWithPasskey(); // No email = discoverable mode
    
    if (!result.success) {
      toast({
        title: "Biometric sign in failed",
        description: result.error || "Please try again or use your password.",
      });
    }
  };

  const switchToSignUp = () => {
    setAuthMode("signup");
    // Clear password fields when switching
    setPassword("");
    setConfirmPassword("");
  };

  const switchToSignIn = () => {
    setAuthMode("signin");
    // Clear password fields when switching
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Show progress indicator if in invite flow */}
      {isInInviteFlow && (
        <InviteFlowProgress 
          currentStep="auth" 
          isIOS={inviteFlowContext?.isIOS}
          isExistingUser={false}
          className="fixed top-0 left-0 right-0"
        />
      )}
      
      <div className={`flex-1 flex flex-col items-center justify-center p-4 ${isInInviteFlow ? 'pt-16' : ''}`}>
      <div className="w-full max-w-md space-y-8 animate-slide-up">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="p-4 rounded-2xl bg-primary glow-emerald">
            <Flame className="h-10 w-10 text-primary-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase tracking-wide">Beta</span>
          </div>
          <p className="text-sm font-medium text-muted-foreground">Club HQ</p>
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          {authMode === "signin" ? (
            <>
              <CardHeader className="pb-2">
                <h2 className="text-xl font-semibold text-center">Sign In</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription className="text-center">
                  Welcome back! Sign in to your account.
                </CardDescription>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="you@example.com"
                        className="pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password">Password</Label>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setForgotPasswordOpen(true)}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  
                  <Button 
                    className="w-full" 
                    onClick={() => handleAuth("signin")}
                    disabled={loading || googleLoading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
                  </Button>
                  
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full gap-2" 
                    onClick={handleGoogleSignIn}
                    disabled={loading || googleLoading || passkeyLoading}
                  >
                    {googleLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <svg className="h-4 w-4" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        Continue with Google
                      </>
                    )}
                  </Button>
                  
                  {biometricsAvailable && (
                    <Button 
                      variant="outline" 
                      className="w-full gap-2" 
                      onClick={handleBiometricSignIn}
                      disabled={loading || googleLoading || passkeyLoading}
                    >
                      {passkeyLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Fingerprint className="h-4 w-4" />
                          Sign in with Face ID / Touch ID
                        </>
                      )}
                    </Button>
                  )}

                  {/* Sign up link */}
                  <div className="text-center text-sm text-muted-foreground pt-2">
                    Don't have an account?{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline font-medium"
                      onClick={switchToSignUp}
                    >
                      Sign up here
                    </button>
                  </div>
                </div>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-2">
                <h2 className="text-xl font-semibold text-center">Create Account</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription className="text-center">
                  Create an account to get started.
                </CardDescription>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        className="pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {password && (
                      <div className="space-y-1 mt-2">
                        {passwordRequirements.map((req, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <div className={`w-1.5 h-1.5 rounded-full ${req.test(password) ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                            <span className={req.test(password) ? 'text-primary' : 'text-muted-foreground'}>
                              {req.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        tabIndex={-1}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button 
                    className="w-full" 
                    onClick={() => handleAuth("signup")}
                    disabled={loading || googleLoading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
                  </Button>
                  
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full gap-2" 
                    onClick={handleGoogleSignIn}
                    disabled={loading || googleLoading}
                  >
                    {googleLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <svg className="h-4 w-4" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        Continue with Google
                      </>
                    )}
                  </Button>

                  {/* Sign in link - only shown when NOT in invite flow */}
                  {!isInInviteFlow && (
                    <div className="text-center text-sm text-muted-foreground pt-2">
                      Already have an account?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={switchToSignIn}
                      >
                        Sign in here
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </>
          )}
        </Card>

        {/* Forgot Password Dialog */}
        <ForgotPasswordDialog 
          open={forgotPasswordOpen} 
          onOpenChange={setForgotPasswordOpen}
          defaultEmail={email}
        />

        {/* Footer Links */}
        <div className="text-center text-xs text-muted-foreground space-y-2">
          <div className="flex justify-center gap-4">
            <a href="/terms" className="hover:text-foreground hover:underline">Terms</a>
            <a href="/privacy" className="hover:text-foreground hover:underline">Privacy</a>
            <a href="/cancellation" className="hover:text-foreground hover:underline">Cancellation</a>
          </div>
          <div className="flex justify-center gap-4">
            <a href="mailto:contact@igniteclubhq.app" className="hover:text-foreground hover:underline">Contact</a>
            <a href="mailto:support@igniteclubhq.app" className="hover:text-foreground hover:underline">Support</a>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
