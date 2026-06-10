import { useState, useEffect, useRef } from "react";
import { Navigate, Link } from "react-router-dom";
import { Flame, Mail, Lock, Loader2, Eye, EyeOff, Fingerprint, CheckCircle2, Circle, XCircle, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { usePasskey, isPlatformAuthenticatorAvailable } from "@/hooks/usePasskey";
import { InviteFlowProgress, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsChecked, setBiometricsChecked] = useState(false);
  const [hibpStatus, setHibpStatus] = useState<'idle' | 'checking' | 'safe' | 'compromised'>('idle');
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);
  const [nativeKeyboardVisible, setNativeKeyboardVisible] = useState(false);
  const signInScrollRef = useRef<HTMLDivElement | null>(null);
  const isNativePlatform = Capacitor.isNativePlatform();
  const { isOnline } = useOnlineStatus();
  
  // Check if we should default to signup view (new user from invite, or returning from terms/privacy)
  const defaultView = sessionStorage.getItem("authDefaultTab") || "signin";
  const [authMode, setAuthMode] = useState<"signin" | "signup">(defaultView as "signin" | "signup");

  // Persist auth mode so navigating to terms/privacy and back preserves the tab
  useEffect(() => {
    sessionStorage.setItem("authDefaultTab", authMode);
  }, [authMode]);
  
  // Check if we're actively in an invite flow - only valid if there's a pending redirect
  const redirectAfterAuth = sessionStorage.getItem("redirectAfterAuth");
  
  // Initialize invite flow context - check if it's stale (no redirect pending)
  const [inviteFlowContext, setInviteFlowContext] = useState(() => {
    const context = getInviteFlowContext();
    // If there's a context but no redirect, it's stale - don't use it
    if (context?.active && !sessionStorage.getItem("redirectAfterAuth")) {
      return null;
    }
    return context;
  });
  
  // Show invite flow progress if there's an active context AND a pending redirect
  // User is not logged in on AuthPage, so we can't check profile completion yet
  const isInInviteFlow = inviteFlowContext?.active === true && !!redirectAfterAuth;
  
  // HIBP compromised password check (k-anonymity — only first 5 chars of SHA1 sent)
  useEffect(() => {
    if (authMode !== 'signup' || !password || password.length < 8) {
      setHibpStatus('idle');
      return;
    }
    setHibpStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const buffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
        const hash = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);
        const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
        const text = await res.text();
        const found = text.split('\n').some(line => line.split(':')[0] === suffix);
        setHibpStatus(found ? 'compromised' : 'safe');
      } catch {
        setHibpStatus('idle'); // Don't block user if API is unavailable
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [password, authMode]);

  // Clear stale invite flow context and session storage on mount
  useEffect(() => {
    sessionStorage.removeItem("authDefaultTab");
    
    // If there's an invite flow context but no pending redirect, it's stale - clear it
    const currentContext = getInviteFlowContext();
    if (currentContext?.active && !redirectAfterAuth) {
      clearInviteFlowContext();
      setInviteFlowContext(null);
      // Also clear any stale PWA pending invite
      localStorage.removeItem("pwa_pending_invite");
    }
  }, [redirectAfterAuth]);
  
  const { toast } = useToast();
  const {
    user,
    profile,
    initialized,
    profileLoading,
    profileResolved,
    profileError,
    signIn,
    signUp,
    signInWithGoogle,
    loading: authLoading,
  } = useAuth();
  const { 
    isAvailable, 
    isRegistered,
    nativeBiometricInfo,
    loading: passkeyLoading, 
    authenticateWithPasskey,
    storeCredentialsForNativeBiometric 
  } = usePasskey();
  
  // Check if biometrics are available (for showing the passkey button)
  useEffect(() => {
    let cancelled = false;
    const checkBiometrics = async () => {
      try {
        const available = await isPlatformAuthenticatorAvailable();
        if (cancelled) return;
        setBiometricsAvailable(available);
      } finally {
        if (!cancelled) setBiometricsChecked(true);
      }
    };
    checkBiometrics();
    return () => { cancelled = true; };
  }, []);

  // On native, usePasskey resolves `nativeBiometricInfo` asynchronously; treat
  // null as "still checking" so the button slot doesn't pop in late.
  const passkeyResolved = isNativePlatform ? nativeBiometricInfo !== null : true;
  const biometricSlotReady = biometricsChecked && passkeyResolved;
  const showBiometricButton = biometricSlotReady && biometricsAvailable && isRegistered;
  // Reserve the button slot on native until checks resolve so the layout
  // doesn't shift up/down when the biometric button finally renders.
  const reserveBiometricSlot = isNativePlatform && !biometricSlotReady;

  useEffect(() => {
    if (!isNativePlatform) return;

    let keyboardShowListener: { remove: () => void } | undefined;
    let keyboardHideListener: { remove: () => void } | undefined;

    // Proactively dismiss any keyboard that may have been open on the
    // previous screen (e.g. user tapped Sign Out from a focused input on
    // Account). Without this, Android can fire a stale `keyboardDidShow`
    // shortly after AuthPage mounts, which would otherwise yank the auth
    // shell upward (justify-start, no translate-y, compact logo).
    Keyboard.hide().catch(() => {});

    // Only treat the keyboard as "open for this page" when one of the
    // AuthPage inputs is actually focused. Spurious system events that
    // fire while focus is elsewhere (or on no element) must not shift
    // the layout.
    const isAuthInputFocused = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
      return signInScrollRef.current?.contains(el) ?? false;
    };

    Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
      if (!isAuthInputFocused()) return;
      setNativeKeyboardHeight(keyboardHeight || 0);
      setNativeKeyboardVisible(true);
    }).then(handle => {
      keyboardShowListener = handle;
    });

    Keyboard.addListener('keyboardDidHide', () => {
      setNativeKeyboardHeight(0);
      setNativeKeyboardVisible(false);
    }).then(handle => {
      keyboardHideListener = handle;
    });

    return () => {
      keyboardShowListener?.remove();
      keyboardHideListener?.remove();
    };
  }, [isNativePlatform]);

  useEffect(() => {
    if (authMode !== "signin" || !isNativePlatform || !nativeKeyboardVisible || typeof window === "undefined") {
      return;
    }

    let timeoutId: number | undefined;

    const resetViewportScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      signInScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };

    const frameId = window.requestAnimationFrame(() => {
      resetViewportScroll();
      timeoutId = window.setTimeout(resetViewportScroll, 80);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [authMode, isNativePlatform, nativeKeyboardVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timeoutId: number | undefined;

    const resetAuthViewport = () => {
      setNativeKeyboardHeight(0);
      setNativeKeyboardVisible(false);

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      signInScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };

    const frameId = window.requestAnimationFrame(() => {
      resetAuthViewport();
      timeoutId = window.setTimeout(resetAuthViewport, 80);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const isSignInMode = authMode === "signin";
  const isSignInKeyboardOpen = isSignInMode && isNativePlatform && nativeKeyboardVisible;
  // On Android with adjustResize, window.innerHeight already excludes the keyboard,
  // so --stable-vh shrinks when the keyboard opens. Using --stable-vh - keyboardHeight
  // would double-subtract the keyboard. Instead, use innerHeight directly when keyboard
  // is open on Android, or just use --stable-vh (which stays stable on iOS).
  const isAndroid = isNativePlatform && !/(iPhone|iPad|iPod)/i.test(navigator.userAgent);
  // On Android, --stable-vh can be momentarily stale right after logout (e.g.
  // the previous screen had the soft keyboard open, so innerHeight was small).
  // Using it here causes the auth shell to render short and then visibly grow
  // — pulling the centered content upward. Use 100vh on Android so the shell
  // is always full-screen; the WebView's adjustResize handles keyboard insets.
  const authViewportHeight = isSignInKeyboardOpen && nativeKeyboardHeight > 0
    ? isAndroid
      ? '100vh' // Android adjustResize already shrinks the viewport — don't subtract again
      : `calc(var(--stable-vh, 100dvh) - ${nativeKeyboardHeight}px)`
    : isAndroid
      ? '100vh'
      : 'var(--stable-vh, 100dvh)';
  const authShellStyle = {
    height: authViewportHeight,
    paddingTop: 'var(--safe-area-top, env(safe-area-inset-top, 0px))',
    paddingBottom: isSignInKeyboardOpen
      ? '0px'
      : 'var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))',
  };
  
  // Determine button text based on platform
  const getBiometricButtonText = () => {
    if (nativeBiometricInfo) {
      switch (nativeBiometricInfo.biometryType) {
        case 'faceId':
          return 'Sign in with Face ID';
        case 'touchId':
          return 'Sign in with Touch ID';
        case 'fingerprint':
          return 'Sign in with Fingerprint';
        case 'iris':
          return 'Sign in with Iris';
        default:
          return 'Sign in with Biometrics';
      }
    }
    return 'Sign in with Face ID / Touch ID';
  };
  


  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-3" style={authShellStyle}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Checking authentication...</p>
      </div>
    );
  }

  const shouldHoldAuthenticatedRedirect = !!user && (!initialized || profileLoading || (!profileResolved && !profileError));

  if (shouldHoldAuthenticatedRedirect) {
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-3" style={authShellStyle}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Finishing sign in...</p>
      </div>
    );
  }

  if (user && profileError) {
    return <Navigate to="/" replace />;
  }

  if (user) {
    // Check for pending redirect (e.g., from invite link) before going to default
    const redirectPath = sessionStorage.getItem("redirectAfterAuth");
    if (redirectPath) {
      sessionStorage.removeItem("redirectAfterAuth");
      console.log('[AuthPage] Authenticated, redirecting to:', redirectPath);
      return <Navigate to={redirectPath} replace />;
    }
    if (!profile?.display_name) {
      console.log('[AuthPage] Authenticated, redirecting to complete-profile');
      return <Navigate to="/complete-profile" replace />;
    }
    // Default to home - clear any stale invite flow context since we're not in a flow
    console.log('[AuthPage] Authenticated, redirecting to home');
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
      
      if (!acceptedTerms) {
        toast({
          title: "Terms & Privacy Policy",
          description: "You must accept the Terms of Service and Privacy Policy to create an account.",
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
        title = "Account already exists";
        message = "This email is already registered. Please sign in using the form below. If you've forgotten your password, tap 'Forgot password?' to reset it.";
        switchToSignIn();
      } else if (message.includes("Invalid login")) {
        title = "Unable to sign in";
        message = "Invalid email or password. Please try again.";
      } else if (message.includes("Email not confirmed")) {
        title = "Email not verified";
        message = "Please check your inbox and verify your email.";
      } else if (
        message.includes("Network") ||
        message.includes("fetch") ||
        /load failed/i.test(message) ||
        /timed? out/i.test(message)
      ) {
        title = "Connection issue";
        message = "We couldn't reach the server. Check your connection and try again.";
      } else if (message.toLowerCase().includes("weak") || message.toLowerCase().includes("easy to guess") || message.toLowerCase().includes("pwned")) {
        title = "Password not accepted";
        message = "This password is too common or has appeared in data breaches. Please choose a more unique password (e.g. add symbols or a random word).";
      }
      toast({
        title,
        description: message,
      });
    } else {
      // Success! On native platforms, offer to save credentials for biometric login
      // Do a fresh check for biometric availability to avoid stale state issues on iOS
      if (mode === "signin" && Capacitor.isNativePlatform()) {
        try {
          // Import dynamically to avoid issues
          const { checkNativeBiometricAvailability } = await import('@/lib/nativeBiometrics');
          const freshBiometricInfo = await checkNativeBiometricAvailability();
          console.log('[AuthPage] Fresh biometric check:', freshBiometricInfo);
          
          if (freshBiometricInfo.isAvailable && !freshBiometricInfo.hasCredentials) {
            // Store credentials for future biometric login (silently)
            await storeCredentialsForNativeBiometric(email, password);
          }
        } catch (e) {
          console.log('[AuthPage] Biometric enrollment check failed:', e);
        }
      }
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

  const shouldLowerDefaultSignIn = isSignInMode && isNativePlatform && !isSignInKeyboardOpen;
  const signInViewportClassName = isSignInMode
    ? isSignInKeyboardOpen
      ? `justify-start pb-4`
      : 'justify-center py-8'
    : 'overflow-y-auto';
  const signInStackClassName = isSignInMode
    ? isSignInKeyboardOpen
      ? 'space-y-4 py-2'
      : `${shouldLowerDefaultSignIn ? 'translate-y-4' : ''} space-y-8 py-6`
    : 'space-y-8 py-8 my-auto';
  const signInCardContentClassName = isSignInKeyboardOpen ? 'space-y-3' : 'space-y-4';
  const signInFormClassName = isSignInKeyboardOpen ? 'space-y-3' : 'space-y-4';
  const signInFieldClassName = isSignInKeyboardOpen ? 'space-y-1.5' : 'space-y-2';

  return (
    <div
      className={`flex flex-col bg-background overflow-hidden ${isNativePlatform ? 'fixed inset-0' : ''}`}
      data-lock-keyboard-scroll="true"
      style={authShellStyle}
    >

      {/* Show progress indicator if in invite flow */}
      {isInInviteFlow && (
        <InviteFlowProgress 
          currentStep="auth" 
          isIOS={inviteFlowContext?.isIOS}
          isExistingUser={false}
          className="fixed top-0 left-0 right-0"
        />
      )}
      
      <div
        ref={signInScrollRef}
        className={`flex-1 flex flex-col items-center px-4 ${signInViewportClassName} ${isInInviteFlow ? 'pt-16' : ''} ${isSignInKeyboardOpen ? 'overflow-y-auto' : ''}`}
      >
      <div className={`w-full max-w-md ${signInStackClassName}`}>
        {/* Logo — compacts when keyboard is open on native sign-in */}
        <div className={`flex flex-col items-center transition-all duration-200 ${isSignInKeyboardOpen ? 'gap-1 mt-2' : 'gap-3 mt-4'}`}>
          <div className={`rounded-2xl bg-primary glow-emerald transition-all duration-200 ${isSignInKeyboardOpen ? 'p-2' : 'p-4'}`}>
            <Flame className={`text-primary-foreground transition-all duration-200 ${isSignInKeyboardOpen ? 'h-5 w-5' : 'h-10 w-10'}`} />
          </div>
          {!isSignInKeyboardOpen && (
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          )}
        </div>

        {!isOnline && (
          <div
            role="alert"
            aria-live="polite"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
          >
            <WifiOff className="h-5 w-5 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">You're offline</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Signing in needs an internet connection. Reconnect to Wi-Fi or mobile data and try again. Once you've signed in on this device, you'll stay signed in even when offline.
              </p>
            </div>
          </div>
        )}

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          {authMode === "signin" ? (
            <>
              <CardHeader className={isSignInKeyboardOpen ? 'pb-1 pt-5' : 'pb-2'}>
                <h2 className={`font-semibold text-center ${isSignInKeyboardOpen ? 'text-lg' : 'text-xl'}`}>Sign In</h2>
              </CardHeader>
              <CardContent className={signInCardContentClassName}>
                {!isSignInKeyboardOpen && (
                  <CardDescription className="text-center">
                    Welcome back! Sign in to your account.
                  </CardDescription>
                )}
                <div className={signInFormClassName}>
                  <div className={signInFieldClassName}>
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
                  <div className={signInFieldClassName}>
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
                  
                  {!isSignInKeyboardOpen && (
                    <>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">Or</span>
                        </div>
                      </div>
                      
                      {/* Hide Google sign-in on native apps - OAuth redirects outside the app */}
                      {!Capacitor.isNativePlatform() && (
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
                      )}
                      
                      {biometricsAvailable && isRegistered && (
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
                              {getBiometricButtonText()}
                            </>
                          )}
                        </Button>
                      )}
                    </>
                  )}

                  {/* Sign up link */}
                  {!isSignInKeyboardOpen && (
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
                  )}
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
                        {/* HIBP compromised password check */}
                        <div className="flex items-center gap-2 text-xs">
                          {hibpStatus === 'checking' && <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin flex-shrink-0" />}
                          {hibpStatus === 'safe' && <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                          {hibpStatus === 'compromised' && <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
                          {hibpStatus === 'idle' && <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />}
                          <span className={
                            hibpStatus === 'safe' ? 'text-primary' :
                            hibpStatus === 'compromised' ? 'text-destructive' :
                            'text-muted-foreground'
                          }>
                            {hibpStatus === 'compromised' ? 'Password found in data breaches — choose another' : 'Not a known compromised password'}
                          </span>
                        </div>
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
                  
                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                      id="accept-terms"
                      checked={acceptedTerms}
                      onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                    />
                    <label htmlFor="accept-terms" className="text-xs text-muted-foreground leading-tight cursor-pointer">
                      I agree to the{" "}
                      <Link to="/terms" {...(!Capacitor.isNativePlatform() ? { target: "_blank" } : {})} className="text-primary hover:underline">Terms of Service</Link>
                      {" "}and{" "}
                      <Link to="/privacy" {...(!Capacitor.isNativePlatform() ? { target: "_blank" } : {})} className="text-primary hover:underline">Privacy Policy</Link>
                    </label>
                  </div>

                  <Button 
                    className="w-full" 
                    onClick={() => handleAuth("signup")}
                    disabled={loading || googleLoading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
                  </Button>
                  
                  {/* Hide Google sign-up on native apps - OAuth redirects outside the app */}
                  {!Capacitor.isNativePlatform() && (
                    <>
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
                    </>
                  )}

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

        {/* Footer Links — hidden when keyboard is open on native sign-in */}
        {!isSignInKeyboardOpen && (
          <div className="text-center text-xs text-muted-foreground space-y-2">
            <div className="flex justify-center gap-4">
              {Capacitor.isNativePlatform() ? (
                <>
                  <Link to="/terms" className="hover:text-foreground hover:underline">Terms</Link>
                  <Link to="/privacy" className="hover:text-foreground hover:underline">Privacy</Link>
                  <Link to="/cancellation" className="hover:text-foreground hover:underline">Cancellation</Link>
                </>
              ) : (
                <>
                  <a href="https://igniteclubhq.com/terms" onClick={(e) => { e.preventDefault(); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://igniteclubhq.com/terms")); }} className="hover:text-foreground hover:underline cursor-pointer">Terms</a>
                  <a href="https://igniteclubhq.com/privacy" onClick={(e) => { e.preventDefault(); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://igniteclubhq.com/privacy")); }} className="hover:text-foreground hover:underline cursor-pointer">Privacy</a>
                  <a href="https://igniteclubhq.com/refunds" onClick={(e) => { e.preventDefault(); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://igniteclubhq.com/refunds")); }} className="hover:text-foreground hover:underline cursor-pointer">Cancellation</a>
                </>
              )}
            </div>
            {!Capacitor.isNativePlatform() && (
              <div className="flex justify-center gap-4">
                <a href="mailto:contact@igniteclubhq.app" className="hover:text-foreground hover:underline">Contact</a>
                <a href="mailto:support@igniteclubhq.app" className="hover:text-foreground hover:underline">Support</a>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
