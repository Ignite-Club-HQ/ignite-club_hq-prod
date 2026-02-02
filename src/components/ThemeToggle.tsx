import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Get theme from DOM (the authoritative source after useAuth applies it)
const getThemeFromDOM = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    // Fallback to localStorage only if DOM doesn't have explicit class
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return 'light';
};

export function ThemeToggle() {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<'light' | 'dark'>(getThemeFromDOM);
  const [isSaving, setIsSaving] = useState(false);

  // CRITICAL: Sync state with DOM when it changes (e.g., after Google OAuth applies theme)
  // This fixes the mismatch where useAuth sets DOM to 'dark' but ThemeToggle state was 'light'
  useEffect(() => {
    const syncThemeFromDOM = () => {
      const domTheme = getThemeFromDOM();
      setThemeState(domTheme);
    };

    // Sync immediately on mount
    syncThemeFromDOM();

    // Watch for class changes on documentElement (handles useAuth theme application)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          syncThemeFromDOM();
          break;
        }
      }
    });

    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });

    return () => observer.disconnect();
  }, []);

  // Apply theme to DOM and localStorage when user toggles
  const applyTheme = useCallback((newTheme: 'light' | 'dark') => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(newTheme);
    root.style.colorScheme = newTheme;
    localStorage.setItem('app-theme', newTheme);
  }, []);

  // Save theme to profile when changed by user
  const saveThemeToProfile = useCallback(async (newTheme: string) => {
    if (!user || isSaving) return;
    
    setIsSaving(true);
    try {
      await supabase
        .from('profiles')
        .update({ theme_preference: newTheme })
        .eq('id', user.id);
    } catch (err) {
      console.error('Failed to save theme preference:', err);
    } finally {
      setIsSaving(false);
    }
  }, [user, isSaving]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setThemeState(newTheme);
    applyTheme(newTheme);
    saveThemeToProfile(newTheme);
  };

  const isDark = theme === 'dark';

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={toggleTheme} 
      disabled={isSaving}
      className="relative"
    >
      <Sun 
        className="h-5 w-5 transition-all" 
        style={{ 
          transform: isDark ? 'rotate(-90deg) scale(0)' : 'rotate(0deg) scale(1)',
          position: isDark ? 'absolute' : 'relative'
        }}
      />
      <Moon 
        className="h-5 w-5 transition-all" 
        style={{ 
          transform: isDark ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0)',
          position: isDark ? 'relative' : 'absolute'
        }}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
