"use client";

import * as React from "react";
import { LocateFixed, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LatLon } from "@/lib/geo";

interface NearMeProps {
  location: LatLon | null;
  onLocationChange: (location: LatLon | null) => void;
}

/**
 * Asks the browser for the viewer's position. Nothing leaves the browser:
 * distances are worked out on the page.
 */
export function NearMe({ location, onLocationChange }: NearMeProps) {
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("Location isn't available in this browser");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onLocationChange({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied"
            : "Couldn't get your location"
        );
      },
      { maximumAge: 10 * 60 * 1000, timeout: 15000 }
    );
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={location ? "secondary" : "outline"}
        onClick={locate}
        disabled={locating}
      >
        {locating ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <LocateFixed className="mr-2 h-4 w-4" />
        )}
        {location ? "Using your location" : "Near me"}
      </Button>
      {location && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onLocationChange(null)}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Clear location</span>
        </Button>
      )}
      {error && <span className="text-xs text-muted-foreground">{error}</span>}
    </div>
  );
}
