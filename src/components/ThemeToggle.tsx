import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function ThemeToggle() {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('app-theme') || 'dark';
    }
    return 'dark';
  });
  const [isSaving, setIsSaving] = useState(false);

  // Apply theme to DOM and localStorage
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  // Load theme from profile on login
  useEffect(() => {
    if (!user) return;
    
    const loadThemeFromProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('theme_preference')
          .eq('id', user.id)
          .single();
        
        if (!error && data?.theme_preference) {
          setThemeState(data.theme_preference);
        }
      } catch (err) {
        console.error('Failed to load theme preference:', err);
      }
    };
    
    loadThemeFromProfile();
  }, [user]);

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

  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} disabled={isSaving}>
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
