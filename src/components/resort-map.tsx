"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Mountain } from "@/lib/types";
import { parseISO, isBefore, startOfDay } from "date-fns";

interface ResortMapProps {
  mountains: Mountain[];
  asOfDate: Date | undefined;
  selectedRegions: string[];
  selectedMountainId: string | null;
  onSelectMountain: (id: string | null) => void;
}

function isOpen(mountain: Mountain, asOfDate: Date): boolean {
  if (!mountain.closingDate) return false;
  return !isBefore(parseISO(mountain.closingDate), startOfDay(asOfDate));
}

function buildGeoJSON(
  mountains: Mountain[],
  referenceDate: Date,
  selectedRegions: string[]
) {
  const filtered =
    selectedRegions.length === 0
      ? mountains
      : mountains.filter((m) => selectedRegions.includes(m.region));

  const features = filtered
    .filter((m) => m.lat != null && m.lon != null)
    .map((m) => ({
      type: "Feature" as const,
      properties: {
        id: m.id,
        name: m.name,
        closingDate: m.closingDate,
        isOpen: isOpen(m, referenceDate),
      },
      geometry: {
        type: "Point" as const,
        coordinates: [m.lon!, m.lat!],
      },
    }));

  return { type: "FeatureCollection" as const, features };
}

/** Create a square image for use as a map marker. */
function createSquareImage(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

const OPEN_COLOR = "#da1e28";
const CLOSED_COLOR = "#a8a8a8";

export function ResortMap({
  mountains,
  asOfDate,
  selectedRegions,
  selectedMountainId,
  onSelectMountain,
}: ResortMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const referenceDate = asOfDate ?? new Date();

  const geojson = useMemo(
    () => buildGeoJSON(mountains, referenceDate, selectedRegions),
    [mountains, referenceDate, selectedRegions]
  );

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style:
        "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-98.5, 39.5],
      zoom: 3.2,
      attributionControl: {},
    });

    mapRef.current = map;

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
    });
    popupRef.current = popup;

    map.on("load", () => {
      map.addImage("square", createSquareImage(16), { sdf: true });

      map.addSource("resorts", {
        type: "geojson",
        data: geojson,
      });

      map.addLayer({
        id: "resorts-layer",
        type: "symbol",
        source: "resorts",
        layout: {
          "icon-image": "square",
          "icon-size": 0.625,
          "icon-allow-overlap": true,
          "symbol-sort-key": ["case", ["get", "isOpen"], 0, 1],
        },
        paint: {
          "icon-color": [
            "case",
            ["get", "isOpen"],
            OPEN_COLOR,
            CLOSED_COLOR,
          ],
          "icon-opacity": ["case", ["get", "isOpen"], 1, 0.6],
        },
      });

      // Hover: show popup
      map.on("mouseenter", "resorts-layer", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const coords = feature.geometry.coordinates.slice() as [number, number];
        const props = feature.properties;
        const dateStr = props.closingDate
          ? new Date(props.closingDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "Unknown";
        const status = props.isOpen ? "Open" : "Closed";
        popup
          .setLngLat(coords)
          .setHTML(
            `<strong style="font-size:13px">${props.name}</strong><br/>` +
              `<span style="font-size:12px;color:${props.isOpen ? OPEN_COLOR : CLOSED_COLOR}">${status}</span>` +
              `<span style="font-size:12px"> · ${dateStr}</span>`
          )
          .addTo(map);
      });

      map.on("mouseleave", "resorts-layer", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      // Click: select mountain
      map.on("click", "resorts-layer", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        onSelectMountain(feature.properties.id);
      });

      // Click outside markers: deselect
      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["resorts-layer"],
        });
        if (features.length === 0) {
          onSelectMountain(null);
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Only run on mount/unmount — data updates handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update GeoJSON data when filters/dates change, and fit bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("resorts") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }

    // Fit map to visible features
    const coords = geojson.features.map(
      (f) => f.geometry.coordinates as [number, number]
    );
    if (coords.length === 0) return;

    const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords) {
      bounds.extend(c);
    }
    map.fitBounds(bounds, { padding: 40, maxZoom: 10, duration: 1000 });
  }, [geojson]);

  return (
    <div
      ref={containerRef}
      className="mb-6 h-[400px] w-full rounded-md border"
    />
  );
}
