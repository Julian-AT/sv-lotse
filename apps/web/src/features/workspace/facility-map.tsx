"use client";

import type { WorkspaceFacility } from "@lotse/brain/workspace/schema";
import type { Map as LibreMap } from "maplibre-gl";
import { type JSX, useEffect, useRef, useState } from "react";
import {
  MAP_ATTRIBUTION,
  MAP_FIT_PADDING,
  MAP_FIT_ZOOM,
  MAP_INITIAL_CENTER,
  MAP_INITIAL_ZOOM,
  MAP_MAX_ZOOM,
  MAP_TILE_SIZE,
  MAP_TILE_URL,
  MAP_WORKER_URL,
} from "./config.ts";
import type { WorkspaceCopy } from "./copy.ts";
import styles from "./workspace.module.css";
import "maplibre-gl/dist/maplibre-gl.css";

export function FacilityMap({
  facilities,
  selectedId,
  onSelect,
  copy,
}: {
  facilities: WorkspaceFacility[];
  selectedId: string;
  onSelect: (id: string) => void;
  copy: WorkspaceCopy;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let map: LibreMap | null = null;
    setFailed(false);
    void import("maplibre-gl")
      .then((libre) => {
        if (disposed || !container.current) return;
        libre.setWorkerUrl(MAP_WORKER_URL);
        map = new libre.Map({
          container: container.current,
          center: MAP_INITIAL_CENTER,
          zoom: MAP_INITIAL_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          scrollZoom: false,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [MAP_TILE_URL],
                tileSize: MAP_TILE_SIZE,
                attribution: MAP_ATTRIBUTION,
                maxzoom: MAP_MAX_ZOOM,
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
        });
        mapRef.current = map;
        map.addControl(new libre.NavigationControl());
        map.on("error", () => {
          if (!disposed) setFailed(true);
        });
        const bounds = new libre.LngLatBounds();
        for (const facility of facilities) {
          if (!facility.location) continue;
          const position: [number, number] = [
            facility.location.longitude,
            facility.location.latitude,
          ];
          bounds.extend(position);
          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = styles.marker ?? "";
          marker.textContent = "●";
          marker.setAttribute("aria-label", facility.title);
          marker.setAttribute("aria-pressed", String(facility.id === selectedRef.current));
          marker.style.zIndex = facility.id === selectedRef.current ? "1" : "0";
          markers.current.set(facility.id, marker);
          marker.addEventListener("click", () => onSelect(facility.id));
          new libre.Marker({ element: marker }).setLngLat(position).addTo(map);
        }
        if (!bounds.isEmpty())
          map.fitBounds(bounds, { padding: MAP_FIT_PADDING, maxZoom: MAP_FIT_ZOOM, duration: 0 });
        const selected = facilities.find((entry) => entry.id === selectedRef.current);
        if (selected?.location)
          map.jumpTo({
            center: [selected.location.longitude, selected.location.latitude],
            zoom: MAP_FIT_ZOOM,
          });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      markers.current.clear();
    };
  }, [facilities, onSelect]);
  useEffect(() => {
    for (const [id, marker] of markers.current) {
      marker.setAttribute("aria-pressed", String(id === selectedId));
      marker.style.zIndex = id === selectedId ? "1" : "0";
    }
    const selected = facilities.find((entry) => entry.id === selectedId);
    if (selected?.location)
      mapRef.current?.jumpTo({
        center: [selected.location.longitude, selected.location.latitude],
        zoom: MAP_FIT_ZOOM,
      });
  }, [selectedId, facilities]);
  return (
    <div>
      {failed && <p role="status">{copy.mapUnavailable}</p>}
      <section ref={container} className={styles.map} aria-label={copy.map} />
    </div>
  );
}
