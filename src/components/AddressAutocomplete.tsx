import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, Plus, X, History, Clock, Star, Trash2, Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface SavedLocation {
  id?: string;
  address: string;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  name?: string | null;
  isFavorite?: boolean;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (address: {
    address: string;
    suburb: string;
    state: string;
    postcode: string;
  }) => void;
  placeholder?: string;
  savedLocations?: SavedLocation[];
}

interface Suggestion {
  place_id: string;
  description: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Search address...",
  savedLocations = [],
}: AddressAutocompleteProps) {
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [showSavedLocations, setShowSavedLocations] = useState(false);
  const [favoriteLocations, setFavoriteLocations] = useState<SavedLocation[]>([]);
  const [currentAddress, setCurrentAddress] = useState<SavedLocation | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch user's saved favorite locations
  useEffect(() => {
    if (!user) return;
    
    const fetchFavorites = async () => {
      const { data, error } = await supabase
        .from('saved_locations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (!error && data) {
        setFavoriteLocations(data.map(loc => ({
          ...loc,
          isFavorite: true
        })));
      }
    };
    
    fetchFavorites();
  }, [user]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value || value.length < 3) {
      setSuggestions([]);
      setSearchAttempted(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setSearchAttempted(true);
      setShowSavedLocations(false);
      try {
        const searchQuery = encodeURIComponent(value);
        let data: any[] = [];
        
        // First search: freeform query
        const freeformResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${searchQuery}&countrycodes=au&limit=5&addressdetails=1&extratags=1&namedetails=1`,
          {
            headers: {
              'Accept': 'application/json',
            }
          }
        );
        data = await freeformResponse.json();
        
        // Try a structured search if we have a pattern like "<number> <street> <suburb>"
        const trimmedValue = value.trim();
        const tokens = trimmedValue.split(/\s+/);
        const hasHouseNumber = tokens.length >= 3 && /^\d+[A-Za-z]?$/.test(tokens[0]);

        if (hasHouseNumber && data.length === 0) {
          const houseNumber = tokens[0];
          const suburb = tokens[tokens.length - 1];
          const streetName = tokens.slice(1, -1).join(" ");

          const structuredResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&street=${encodeURIComponent(
              houseNumber + " " + streetName
            )}&city=${encodeURIComponent(suburb)}&countrycodes=au&limit=5&addressdetails=1&namedetails=1`,
            {
              headers: {
                Accept: "application/json",
              },
            }
          );
          const structuredData = await structuredResponse.json();
          if (structuredData.length > 0) {
            data = structuredData;
          }
        }

        // If still no results, try searching just street + suburb as freeform
        if (data.length === 0 && hasHouseNumber) {
          const suburb = tokens[tokens.length - 1];
          const streetName = tokens.slice(1, -1).join(" ");
          const fallbackResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
              streetName + " " + suburb
            )}&countrycodes=au&limit=5&addressdetails=1&namedetails=1`,
            {
              headers: {
                Accept: "application/json",
              },
            }
          );
          data = await fallbackResponse.json();
        }
        
        // Sort results to prioritize exact matches and venues
        const sortedData = data.sort((a: any, b: any) => {
          // Prioritize venues (ovals, parks, etc) if searching for them
          const aIsVenue = a.class === 'leisure' || a.class === 'amenity' || a.class === 'sport';
          const bIsVenue = b.class === 'leisure' || b.class === 'amenity' || b.class === 'sport';
          if (aIsVenue && !bIsVenue) return -1;
          if (!aIsVenue && bIsVenue) return 1;
          
          // Then prioritize by importance
          return (b.importance || 0) - (a.importance || 0);
        });
        
        setSuggestions(
          sortedData.map((item: any) => ({
            place_id: item.place_id,
            description: item.display_name,
            address: item.address,
            name: item.namedetails?.name || item.name,
          }))
        );
        setShowSuggestions(true);
      } catch (error) {
        console.error("Address search error:", error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value]);

  const handleSelect = async (suggestion: any) => {
    // Try to preserve any leading street number from the user's typed value
    const trimmedValue = value.trim();
    const leadingNumberMatch = trimmedValue.match(/^(\d+[A-Za-z]?)/);

    let displayAddress = suggestion.description as string;

    if (leadingNumberMatch) {
      const leadingNumber = leadingNumberMatch[1];
      const suggestionFirstPart = displayAddress.split(",")[0].trim();

      // If the suggestion is missing the number, prepend it
      if (!suggestionFirstPart.startsWith(leadingNumber)) {
        const parts = displayAddress.split(",");
        parts[0] = `${leadingNumber} ${suggestionFirstPart.replace(/^\d+\s*/, "").trim()}`;
        displayAddress = parts.join(", ");
      }
    }

    onChange(displayAddress);
    setShowSuggestions(false);
    setShowSavedLocations(false);

    if (onSelect && suggestion.address) {
      const addr = suggestion.address;
      
      // For venues (ovals, parks, sports facilities), use the venue name as the address
      // Check for venue name in namedetails or the first part of description
      const venueName = suggestion.name;
      const isVenue = addr.leisure || addr.amenity || addr.sport || 
                      (venueName && !venueName.match(/^\d/)); // Has a name that doesn't start with a number
      
      let finalStreet: string;
      
      if (isVenue && venueName) {
        // For venues, use the venue name, optionally with street info
        const streetPart = [addr.house_number, addr.road].filter(Boolean).join(" ");
        finalStreet = streetPart ? `${venueName}, ${streetPart}` : venueName;
      } else {
        // For regular addresses, use house number + road
        const baseStreet =
          [addr.house_number, addr.road].filter(Boolean).join(" ") ||
          suggestion.description.split(",")[0];

        finalStreet = baseStreet;
        if (leadingNumberMatch) {
          const leadingNumber = leadingNumberMatch[1];
          if (!baseStreet.trim().startsWith(leadingNumber)) {
            finalStreet = `${leadingNumber} ${baseStreet.replace(/^\d+\s*/, "").trim()}`;
          }
        }
      }

      onSelect({
        address: finalStreet,
        suburb: addr.suburb || addr.city || addr.town || "",
        state: addr.state || "",
        postcode: addr.postcode || "",
      });
      setCurrentAddress({
        address: finalStreet,
        suburb: addr.suburb || addr.city || addr.town || "",
        state: addr.state || "",
        postcode: addr.postcode || "",
      });
    }
  };

  const handleSaveAsFavorite = async () => {
    if (!user || !currentAddress?.address) {
      toast.error("Please select an address first");
      return;
    }

    try {
      const { data, error } = await supabase
        .from('saved_locations')
        .insert({
          user_id: user.id,
          address: currentAddress.address,
          suburb: currentAddress.suburb || null,
          state: currentAddress.state || null,
          postcode: currentAddress.postcode || null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast.info("This location is already saved");
        } else {
          throw error;
        }
      } else {
        setFavoriteLocations(prev => [{ ...data, isFavorite: true }, ...prev]);
        toast.success("Location saved to favorites");
      }
    } catch (error) {
      console.error("Error saving location:", error);
      toast.error("Failed to save location");
    }
  };

  const handleRemoveFavorite = async (e: React.MouseEvent, locationId: string) => {
    e.stopPropagation();
    if (!user) return;

    try {
      const { error } = await supabase
        .from('saved_locations')
        .delete()
        .eq('id', locationId)
        .eq('user_id', user.id);

      if (error) throw error;

      setFavoriteLocations(prev => prev.filter(loc => loc.id !== locationId));
      toast.success("Location removed from favorites");
    } catch (error) {
      console.error("Error removing location:", error);
      toast.error("Failed to remove location");
    }
  };

  const isCurrentAddressSaved = currentAddress?.address && 
    favoriteLocations.some(loc => loc.address === currentAddress.address);

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setGpsLoading(true);
    setShowSuggestions(false);
    setShowSavedLocations(false);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          
          // Reverse geocode using Nominatim
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
            {
              headers: {
                'Accept': 'application/json',
              }
            }
          );
          
          const data = await response.json();
          
          if (data && data.address) {
            const addr = data.address;
            const street = [addr.house_number, addr.road].filter(Boolean).join(" ") || "";
            const suburb = addr.suburb || addr.city || addr.town || addr.village || "";
            const state = addr.state || "";
            const postcode = addr.postcode || "";
            
            const fullAddress = [street, suburb, state, postcode].filter(Boolean).join(", ");
            
            onChange(fullAddress);
            setCurrentAddress({
              address: street,
              suburb,
              state,
              postcode,
            });
            
            if (onSelect) {
              onSelect({
                address: street,
                suburb,
                state,
                postcode,
              });
            }
            
            toast.success("Location detected");
          } else {
            toast.error("Could not determine address from location");
          }
        } catch (error) {
          console.error("Reverse geocoding error:", error);
          toast.error("Failed to get address from location");
        } finally {
          setGpsLoading(false);
        }
      },
      (error) => {
        setGpsLoading(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            toast.error("Location access denied. Please enable location permissions.");
            break;
          case error.POSITION_UNAVAILABLE:
            toast.error("Location information is unavailable");
            break;
          case error.TIMEOUT:
            toast.error("Location request timed out");
            break;
          default:
            toast.error("Failed to get your location");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const handleSelectSavedLocation = (location: SavedLocation) => {
    const fullAddress = [location.address, location.suburb, location.state, location.postcode]
      .filter(Boolean)
      .join(", ");
    
    onChange(fullAddress || location.address);
    setShowSavedLocations(false);
    setShowSuggestions(false);
    setCurrentAddress({
      address: location.address,
      suburb: location.suburb || "",
      state: location.state || "",
      postcode: location.postcode || "",
    });

    if (onSelect) {
      onSelect({
        address: location.address,
        suburb: location.suburb || "",
        state: location.state || "",
        postcode: location.postcode || "",
      });
    }
  };

  // Combine favorites and recent locations, favorites first
  const allSavedLocations = [
    ...favoriteLocations,
    ...savedLocations.filter(loc => 
      !favoriteLocations.some(fav => fav.address === loc.address)
    ).map(loc => ({ ...loc, isFavorite: false }))
  ];

  const handleUseCustomAddress = () => {
    setShowSuggestions(false);
    setShowSavedLocations(false);
    // Use the typed value as-is for the address
    if (onSelect) {
      onSelect({
        address: value,
        suburb: "",
        state: "",
        postcode: "",
      });
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange("");
    setSuggestions([]);
    setShowSuggestions(false);
    setShowSavedLocations(false);
    setSearchAttempted(false);
    // Keep focus on input so user can continue typing
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (suggestions.length > 0 || (searchAttempted && value.length >= 3)) {
      setShowSuggestions(true);
    } else if (!value && allSavedLocations.length > 0) {
      setShowSavedLocations(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setCurrentAddress(null);
    if (!e.target.value && allSavedLocations.length > 0) {
      setShowSavedLocations(true);
      setShowSuggestions(false);
    } else {
      setShowSavedLocations(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="pl-9 pr-24"
          onFocus={handleFocus}
          onBlur={() => setTimeout(() => {
            setShowSuggestions(false);
            setShowSavedLocations(false);
          }, 200)}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {(loading || gpsLoading) && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {!loading && !gpsLoading && (
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
              onClick={handleUseCurrentLocation}
              aria-label="Use current location"
              title="Use current location"
            >
              <Navigation className="h-4 w-4" />
            </button>
          )}
          {currentAddress && user && !isCurrentAddressSaved && !loading && !gpsLoading && (
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
              onClick={handleSaveAsFavorite}
              aria-label="Save to favorites"
              title="Save to favorites"
            >
              <Star className="h-4 w-4" />
            </button>
          )}
          {value && !loading && !gpsLoading && (
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleClear}
              aria-label="Clear address"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Saved locations dropdown */}
      {showSavedLocations && allSavedLocations.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {favoriteLocations.length > 0 && (
            <>
              <div className="px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Star className="h-3 w-3 fill-primary text-primary" />
                  Saved Locations
                </span>
              </div>
              {favoriteLocations.map((location) => {
                const displayText = [location.name || location.address, location.suburb, location.state]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={location.id}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 group"
                    onClick={() => handleSelectSavedLocation(location)}
                  >
                    <Star className="h-4 w-4 fill-primary text-primary shrink-0" />
                    <span className="line-clamp-2 flex-1">{displayText}</span>
                    <button
                      type="button"
                      className="h-6 w-6 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                      onClick={(e) => handleRemoveFavorite(e, location.id!)}
                      aria-label="Remove from favorites"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </button>
                );
              })}
            </>
          )}
          {savedLocations.filter(loc => !favoriteLocations.some(fav => fav.address === loc.address)).length > 0 && (
            <>
              <div className="px-3 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Recent Locations
                </span>
              </div>
              {savedLocations
                .filter(loc => !favoriteLocations.some(fav => fav.address === loc.address))
                .slice(0, 5)
                .map((location, index) => {
                  const displayText = [location.address, location.suburb, location.state]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <button
                      key={`recent-${index}`}
                      className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors flex items-start gap-2"
                      onClick={() => handleSelectSavedLocation(location)}
                    >
                      <History className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="line-clamp-2">{displayText}</span>
                    </button>
                  );
                })}
            </>
          )}
        </div>
      )}

      {/* Search suggestions dropdown */}
      {showSuggestions && (suggestions.length > 0 || (searchAttempted && value.length >= 3)) && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((suggestion: any) => (
            <button
              key={suggestion.place_id}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-start gap-2"
              onClick={() => handleSelect(suggestion)}
            >
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <span className="line-clamp-2">{suggestion.description}</span>
            </button>
          ))}
          
          {/* Always show option to use custom address when user has typed enough */}
          {value.length >= 3 && (
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-start gap-2 border-t border-border"
              onClick={handleUseCustomAddress}
            >
              <Plus className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span className="text-primary">Use "{value}" as location</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}