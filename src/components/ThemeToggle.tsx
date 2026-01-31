import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function ThemeToggle() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('app-theme') || 'light';
    }
    return 'light';
  });
  const [isSaving, setIsSaving] = useState(false);

  // Track mount state to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply theme to DOM and localStorage
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  // No need to load theme from profile here - useAuth handles it on fresh login
  // On page refresh, localStorage (set by index.html) is the source of truth

  // Save theme to profile when changed
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
    saveThemeToProfile(newTheme);
  };

  const isDark = theme === 'dark';

  // Use explicit styling based on current theme state to prevent flash
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
