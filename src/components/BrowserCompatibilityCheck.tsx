import { useState, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "browser-compat-dismissed";

// Check for features required by the app
function checkBrowserCompatibility(): { supported: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for ES6+ features
  try {
    // Arrow functions, const/let, template literals
    eval("const x = () => `test`");
  } catch {
    issues.push("Modern JavaScript (ES6+)");
  }

  // Check for Promise
  if (typeof Promise === "undefined") {
    issues.push("Promises");
  }

  // Check for fetch API
  if (typeof fetch === "undefined") {
    issues.push("Fetch API");
  }

  // Check for CSS Custom Properties (CSS Variables)
  if (!window.CSS || !window.CSS.supports || !window.CSS.supports("--test", "0")) {
    issues.push("CSS Variables");
  }

  // Check for flexbox
  if (!window.CSS || !window.CSS.supports || !window.CSS.supports("display", "flex")) {
    issues.push("Flexbox layout");
  }

  // Check for localStorage
  try {
    localStorage.setItem("test", "test");
    localStorage.removeItem("test");
  } catch {
    issues.push("Local Storage");
  }

  // Check for Service Worker (needed for PWA features)
  if (!("serviceWorker" in navigator)) {
    // This is a warning, not a blocker
  }

  // Check for IntersectionObserver (used for lazy loading)
  if (typeof IntersectionObserver === "undefined") {
    issues.push("IntersectionObserver");
  }

  // Check for URLSearchParams
  if (typeof URLSearchParams === "undefined") {
    issues.push("URL handling");
  }

  return {
    supported: issues.length === 0,
    issues,
  };
}

export function BrowserCompatibilityCheck() {
  const [showBanner, setShowBanner] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    // Check if already dismissed
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) {
      return;
    }

    const result = checkBrowserCompatibility();
    if (!result.supported) {
      setIssues(result.issues);
      setShowBanner(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setShowBanner(false);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">
              Browser Update Recommended
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Your browser may not support all features of this app. For the best experience, please update to a modern browser.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {issues.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Missing features:
            </p>
            <ul className="text-sm text-foreground space-y-1">
              {issues.map((issue, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">
            <strong>Recommended browsers:</strong>
            <br />
            Chrome 60+, Safari 11.1+, Firefox 55+, Edge 79+
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleDismiss}
            className="flex-1"
          >
            Continue Anyway
          </Button>
          <Button
            onClick={() => window.open("https://browsehappy.com/", "_blank")}
            className="flex-1"
          >
            Update Browser
          </Button>
        </div>
      </div>
    </div>
  );
}
