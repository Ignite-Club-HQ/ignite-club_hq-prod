import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Flame, Mail, Lock, Loader2, Eye, EyeOff, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { usePasskey, getStoredPasskeyEmail, isPlatformAuthenticatorAvailable } from "@/hooks/usePasskey";

import { z } from "zod";

const authSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

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
  const { toast } = useToast();
  const { user, signIn, signUp, signInWithGoogle, loading: authLoading } = useAuth();
  const { isAvailable, isRegistered, loading: passkeyLoading, authenticateWithPasskey } = usePasskey();
  
  // Check if biometrics are available and user has a registered passkey
  useEffect(() => {
    const checkBiometrics = async () => {
      const available = await isPlatformAuthenticatorAvailable();
      const storedEmail = getStoredPasskeyEmail();
      setBiometricsAvailable(available && !!storedEmail);
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
    const redirectPath = sessionStorage.getItem("redirectAfterAuth");
    if (redirectPath) {
      sessionStorage.removeItem("redirectAfterAuth");
      return <Navigate to={redirectPath} replace />;
    }
    return <Navigate to="/" replace />;
  }

  const handleAuth = async (mode: "signin" | "signup") => {
    const validation = authSchema.safeParse({ email, password });
    if (!validation.success) {
      toast({
        title: "Please check your details",
        description: validation.error.errors[0].message,
      });
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please ensure both passwords are identical.",
      });
      return;
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
    const storedEmail = getStoredPasskeyEmail();
    if (!storedEmail) {
      toast({
        title: "No passkey found",
        description: "Please sign in with your email and password first, then set up biometric login in your profile.",
      });
      return;
    }

    const result = await authenticateWithPasskey(storedEmail);
    
    if (!result.success) {
      toast({
        title: "Biometric sign in failed",
        description: result.error || "Please try again or use your password.",
      });
    }
  };


  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
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
          <Tabs defaultValue="signin" className="w-full">
            <CardHeader className="pb-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
            </CardHeader>
            
            <TabsContent value="signin">
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
                  
                </div>
              </CardContent>
            </TabsContent>

            <TabsContent value="signup">
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
                </div>
              </CardContent>
            </TabsContent>
          </Tabs>
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
  );
}
