"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Mountain } from "@/lib/types";
import { getDrawRank, getMountainStatus, STATUS_LABEL, type MountainStatus } from "@/lib/status";
import { matchesTerrain, TERRAIN_LABEL, type TerrainFilter } from "@/lib/terrain";

interface ResortMapProps {
  mountains: Mountain[];
  asOfDate: Date | undefined;
  selectedRegions: string[];
  terrainFilter: TerrainFilter;
  selectedMountainId: string | null;
  onSelectMountain: (id: string | null) => void;
}

function buildGeoJSON(
  mountains: Mountain[],
  referenceDate: Date,
  selectedRegions: string[],
  terrainFilter: TerrainFilter
) {
  const filtered = mountains.filter(
    (m) =>
      (selectedRegions.length === 0 || selectedRegions.includes(m.region)) &&
      matchesTerrain(m.terrain, terrainFilter)
  );

  const features = filtered
    .filter((m) => m.lat != null && m.lon != null)
    .map((m) => {
      const status = getMountainStatus(m, referenceDate);
      return {
        type: "Feature" as const,
        properties: {
          id: m.id,
          name: m.name,
          openingDate: m.openingDate ?? null,
          closingDate: m.closingDate,
          status,
          drawRank: getDrawRank(status, referenceDate),
          terrain: m.terrain ?? "alpine",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [m.lon!, m.lat!],
        },
      };
    });

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

/** Create a round image: cross-country-only areas use circles. */
function createCircleImage(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

const STATUS_COLOR: Record<MountainStatus, string> = {
  open: "#da1e28",
  "opening-soon": "#0f62fe",
  unknown: "#a8a8a8",
  closed: "#a8a8a8",
};

const formatDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown";

export function ResortMap({
  mountains,
  asOfDate,
  selectedRegions,
  terrainFilter,
  selectedMountainId,
  onSelectMountain,
}: ResortMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const referenceDate = asOfDate ?? new Date();

  const geojson = useMemo(
    () => buildGeoJSON(mountains, referenceDate, selectedRegions, terrainFilter),
    [mountains, referenceDate, selectedRegions, terrainFilter]
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
      map.addImage("circle", createCircleImage(18), { sdf: true });

      map.addSource("resorts", {
        type: "geojson",
        data: geojson,
      });

      map.addLayer({
        id: "resorts-layer",
        type: "symbol",
        source: "resorts",
        layout: {
          "icon-image": ["match", ["get", "terrain"], "xc", "circle", "square"],
          "icon-size": 0.625,
          "icon-allow-overlap": true,
          // MapLibre draws lower sort keys first (underneath), so higher
          // ranks land on top. See getDrawRank for the season-aware order.
          "symbol-sort-key": ["get", "drawRank"],
        },
        paint: {
          "icon-color": [
            "match",
            ["get", "status"],
            "open", STATUS_COLOR.open,
            "opening-soon", STATUS_COLOR["opening-soon"],
            STATUS_COLOR.closed,
          ],
          "icon-opacity": [
            "match",
            ["get", "status"],
            ["open", "opening-soon"],
            1,
            0.6,
          ],
        },
      });

      // Hover: show popup
      map.on("mouseenter", "resorts-layer", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const coords = feature.geometry.coordinates.slice() as [number, number];
        const props = feature.properties;
        const status = props.status as MountainStatus;
        // GeoJSON properties come back from MapLibre with nulls as "null"
        const opening = props.openingDate && props.openingDate !== "null" ? props.openingDate : null;
        const closing = props.closingDate && props.closingDate !== "null" ? props.closingDate : null;
        const detail =
          status === "opening-soon"
            ? `opens ${formatDate(opening)}`
            : status === "closed"
              ? `closed ${formatDate(closing)}`
              : `closes ${formatDate(closing)}`;
        popup
          .setLngLat(coords)
          .setHTML(
            `<strong style="font-size:13px">${props.name}</strong><br/>` +
              `<span style="font-size:12px;color:${STATUS_COLOR[status]}">${STATUS_LABEL[status]}</span>` +
              `<span style="font-size:12px"> · ${detail}</span>` +
              (props.terrain !== "alpine"
                ? `<br/><span style="font-size:11px;color:#6f6f6f">${TERRAIN_LABEL[props.terrain as keyof typeof TERRAIN_LABEL]}</span>`
                : "")
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
    <div className="mb-6">
      <div ref={containerRef} className="h-[400px] w-full rounded-md border" />
      <MapLegend />
    </div>
  );
}

function LegendSwatch({ color, round = false }: { color: string; round?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 ${round ? "rounded-full" : ""}`}
      style={{ backgroundColor: color }}
    />
  );
}

function MapLegend() {
  const item = "flex items-center gap-1.5";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className={item}>
        <LegendSwatch color={STATUS_COLOR.open} />
        {STATUS_LABEL.open}
      </span>
      <span className={item}>
        <LegendSwatch color={STATUS_COLOR["opening-soon"]} />
        {STATUS_LABEL["opening-soon"]}
      </span>
      <span className={item}>
        <LegendSwatch color={STATUS_COLOR.closed} />
        Closed or unknown
      </span>
      <span className="h-3 w-px bg-border" aria-hidden />
      <span className={item}>
        <LegendSwatch color="#6f6f6f" />
        Downhill
      </span>
      <span className={item}>
        <LegendSwatch color="#6f6f6f" round />
        Cross-country only
      </span>
    </div>
  );
}
