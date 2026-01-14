import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface AppAdCarouselProps {
  location: "home" | "events" | "messages";
  hasSponsorAds: boolean;
}

interface AppAd {
  id: string;
  name: string;
  image_url: string;
  link_url: string | null;
  description: string | null;
}

export function AppAdCarousel({ location, hasSponsorAds }: AppAdCarouselProps) {
  const { trackView, trackClick } = useAdAnalytics();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Check if user has admin roles
  const { data: isAdmin } = useQuery({
    queryKey: ["user-is-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["club_admin", "team_admin", "app_admin"]);
      
      return (roles?.length ?? 0) > 0;
    },
    enabled: !!user?.id,
  });

  // Fetch ad settings for this location
  const { data: settings } = useQuery({
    queryKey: ["app-ad-settings", location],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("*")
        .eq("location", location)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch active ads
  const { data: ads } = useQuery({
    queryKey: ["app-ads-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as AppAd[];
    },
    enabled: !!settings?.is_enabled,
  });

  // Determine if we should show ads
  const shouldShowAds = settings?.is_enabled && ads && ads.length > 0 && (
    settings.override_sponsors || 
    (settings.show_only_when_no_sponsors && !hasSponsorAds) ||
    (!settings.override_sponsors && !settings.show_only_when_no_sponsors)
  );

  // Auto-rotate ads
  useEffect(() => {
    if (!ads || ads.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % ads.length);
    }, 8000);
    
    return () => clearInterval(interval);
  }, [ads]);

  // Track view when ad is displayed
  useEffect(() => {
    if (shouldShowAds && ads && ads[currentIndex]) {
      const context = `${location}_page` as "home_page" | "events_page" | "messages_page";
      trackView(ads[currentIndex].id, context);
    }
  }, [shouldShowAds, ads, currentIndex, location, trackView]);

  // Reset index if out of bounds
  useEffect(() => {
    if (ads && currentIndex >= ads.length) {
      setCurrentIndex(0);
    }
  }, [ads, currentIndex]);

  if (!shouldShowAds || !ads || ads.length === 0) {
    return null;
  }

  const currentAd = ads[currentIndex];
  const context = `${location}_page` as "home_page" | "events_page" | "messages_page";

  const isUpgradeAd = currentAd.link_url?.includes("upgrade") || 
                      currentAd.name.toLowerCase().includes("upgrade") ||
                      currentAd.name.toLowerCase().includes("pro");

  const handleClick = () => {
    trackClick(currentAd.id, context);
    
    // Special handling for upgrade ads
    if (isUpgradeAd) {
      // If user is not an admin, show message to contact admin
      if (!isAdmin) {
        toast({
          title: "Contact Your Admin",
          description: "Please contact your club or team admin to upgrade to Pro.",
        });
        return;
      }
      
      // Admin users - navigate to profile and scroll to manage plans
      navigate('/profile');
      setTimeout(() => {
        const managePlansSection = document.getElementById('manage-plans-section');
        if (managePlansSection) {
          managePlansSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
      return;
    }
    
    if (currentAd.link_url) {
      // For other ads, check if it's an internal or external link
      if (currentAd.link_url.startsWith("/")) {
        navigate(currentAd.link_url);
      } else {
        window.open(currentAd.link_url, "_blank");
      }
    }
  };

  return (
    <div className="w-full">
      <div 
        className="relative rounded-lg overflow-hidden cursor-pointer group"
        onClick={handleClick}
      >
        <img 
          src={currentAd.image_url} 
          alt={currentAd.name}
          className="w-full h-28 object-contain transition-transform group-hover:scale-[1.02]"
        />
        <div className="absolute top-2 right-2">
          <span className="text-[10px] bg-black/40 text-white/70 px-1.5 py-0.5 rounded">Ad</span>
        </div>
      </div>
      
      {/* Pagination dots */}
      {ads.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {ads.map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(index);
              }}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                index === currentIndex ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
