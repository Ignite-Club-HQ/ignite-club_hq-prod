import { MapPin } from "lucide-react";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";

export type EventLocation = {
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  locationName?: string | null;
  legacyLocation?: string | null;
};

export function resolveEventMapAddress(location: EventLocation): string | null {
  return location.address || location.legacyLocation || location.locationName || null;
}

export function EventLocationDetails(location: EventLocation) {
  if (location.address) {
    const locality = [location.suburb, location.state, location.postcode].filter(Boolean).join(", ");
    return (
      <div className="flex items-start gap-3">
        <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p>{location.address}</p>
          {locality && <p className="text-muted-foreground">{locality}</p>}
        </div>
      </div>
    );
  }
  if (!location.locationName && !location.legacyLocation) return null;
  return (
    <div className="flex items-start gap-3">
      <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
      <div>
        {location.locationName && <p>{location.locationName}</p>}
        {location.legacyLocation && location.legacyLocation !== location.locationName && (
          <p className="text-muted-foreground">{location.legacyLocation}</p>
        )}
      </div>
    </div>
  );
}

export function EventLocationMap(location: EventLocation) {
  const address = resolveEventMapAddress(location);
  if (!address) return null;
  return <GoogleMapEmbed address={address} className="w-full h-48 rounded-lg border" />;
}
