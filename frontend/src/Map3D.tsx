import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre 6 loads its tile worker from a separate file; point it at the copy Vite emits.
maplibregl.setWorkerUrl(workerUrl);
import type { Health, Segment } from './state';

// Same colours as the 2D map in ui.tsx.
const HEALTH_COLOR: Record<Health, string> = { 'Very Poor': '#800000', Poor: '#DC2626', Fair: '#D97706', Good: '#16A34A' };
// Free OpenStreetMap vector style with extruded 3D buildings; no API key.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

function toGeoJson(segments: Segment[], selectedId?: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: segments.map(s => ({
      type: 'Feature',
      properties: { id: s.id, color: HEALTH_COLOR[s.health] || HEALTH_COLOR.Good, selected: s.id === selectedId },
      geometry: { type: 'LineString', coordinates: s.coords.map(([lat, lng]) => [lng, lat]) },
    })),
  };
}

function boundsOf(coords: [number, number][]) {
  const b = new maplibregl.LngLatBounds();
  coords.forEach(([lat, lng]) => b.extend([lng, lat]));
  return b;
}

/** Tilted, rotatable 3D condition map of the corridor. Shows `fallback` (the 2D map) if WebGL is unavailable. */
export default function Map3D({
  segments,
  selected,
  onSelect,
  fallback,
}: {
  segments: Segment[];
  selected: Segment | null;
  onSelect: (s: Segment) => void;
  fallback: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latest = useRef({ segments, selected, onSelect });
  latest.current = { segments, selected, onSelect };
  const [failed, setFailed] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: host.current,
        style: STYLE_URL,
        center: [76.9105, 8.6262],
        zoom: 15,
        pitch: 60,
        bearing: -20,
        maxPitch: 75,
        cooperativeGestures: true, // page scroll is never trapped; Ctrl/two fingers to zoom
      });
    } catch {
      setFailed(true); // no WebGL
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('load', () => {
      const { segments: segs, selected: sel } = latest.current;
      map.addSource('segments', { type: 'geojson', data: toGeoJson(segs, sel?.id) });
      const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
      map.addLayer({ id: 'seg-casing', type: 'line', source: 'segments', layout, paint: { 'line-color': '#17233b', 'line-width': 12 } });
      map.addLayer({
        id: 'seg',
        type: 'line',
        source: 'segments',
        layout,
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 9, 6] },
      });
      map.on('click', 'seg', (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        const s = latest.current.segments.find(x => x.id === id);
        if (s) latest.current.onSelect(s);
      });
      map.on('mouseenter', 'seg', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'seg', () => { map.getCanvas().style.cursor = ''; });
      const all = segs.flatMap(s => s.coords);
      if (all.length > 1) {
        map.fitBounds(boundsOf(all), { padding: 50, pitch: 60, bearing: -20, duration: 0 });
        fitted.current = true;
      }
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Live data and selection changes.
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource('segments') as maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    src.setData(toGeoJson(segments, selected?.id));
    const all = segments.flatMap(s => s.coords);
    if (!fitted.current && all.length > 1) {
      map.fitBounds(boundsOf(all), { padding: 50, pitch: 60, duration: 0 });
      fitted.current = true;
    }
  }, [segments, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && selected?.coords.length) map.fitBounds(boundsOf(selected.coords), { padding: 70, pitch: 60, duration: 800 });
  }, [selected]);

  if (failed) return <>{fallback}</>;
  return <div ref={host} className="map3d" role="region" aria-label="3D road condition map. Click a road segment for details." />;
}
