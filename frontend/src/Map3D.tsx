import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Health, Segment } from './state';

// MapLibre 6 loads its tile worker from a separate file; point it at the copy Vite emits.
maplibregl.setWorkerUrl(workerUrl);

// Same colours as the 2D map in ui.tsx.
const HEALTH_COLOR: Record<Health, string> = { 'Very Poor': '#800000', Poor: '#DC2626', Fair: '#D97706', Good: '#16A34A' };
// Free OpenStreetMap vector style with extruded 3D buildings; no API key.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ROAD_HALF_WIDTH_M = 12; // width of the raised road block
const RAISED_M = 60; // height of the hovered segment
const FLAT_M = 2;
const HIT_LAYERS = ['seg-3d', 'seg'];

const lngLat = ([lat, lng]: [number, number]) => [lng, lat];
const colorOf = (s: Segment) => HEALTH_COLOR[s.health] || HEALTH_COLOR.Good;

/** Road polyline widened into a polygon (flat projection, fine at corridor scale) so it can be extruded. */
function roadPolygon(coords: [number, number][]): number[][] {
  const lat0 = (coords[0][0] * Math.PI) / 180;
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;
  const left: number[][] = [];
  const right: number[][] = [];
  coords.forEach((p, i) => {
    const a = coords[Math.max(0, i - 1)];
    const b = coords[Math.min(coords.length - 1, i + 1)];
    const dx = (b[1] - a[1]) * kx;
    const dy = (b[0] - a[0]) * ky;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * ROAD_HALF_WIDTH_M; // unit normal, in metres
    const ny = (dx / len) * ROAD_HALF_WIDTH_M;
    left.push([p[1] + nx / kx, p[0] + ny / ky]);
    right.push([p[1] - nx / kx, p[0] - ny / ky]);
  });
  return [...left, ...right.reverse(), left[0]];
}

function sources(segments: Segment[], selectedId?: string) {
  const usable = segments.filter(s => s.coords.length > 1);
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
  return {
    lines: fc(usable.map(s => ({
      type: 'Feature',
      properties: { id: s.id, color: colorOf(s), selected: s.id === selectedId },
      geometry: { type: 'LineString', coordinates: s.coords.map(lngLat) },
    }))),
    blocks: fc(usable.map(s => ({
      type: 'Feature',
      properties: { id: s.id, color: colorOf(s) },
      geometry: { type: 'Polygon', coordinates: [roadPolygon(s.coords)] },
    }))),
    labels: fc(usable.map(s => ({
      type: 'Feature',
      properties: { id: s.id, label: `${s.id.split('-').pop()} · PCI ${s.pci}` },
      geometry: { type: 'Point', coordinates: lngLat(s.coords[Math.floor(s.coords.length / 2)]) },
    }))),
    // Start and end of every segment, so the three segments read as separate pieces.
    ends: fc(usable.flatMap(s => [s.coords[0], s.coords[s.coords.length - 1]].map(p => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: lngLat(p) },
    })))),
  };
}

function boundsOf(coords: [number, number][]) {
  const b = new maplibregl.LngLatBounds();
  coords.forEach(([lat, lng]) => b.extend([lng, lat]));
  return b;
}

/**
 * Tilted, rotatable 3D condition map of the corridor. Hovering a segment raises it; clicking opens its details.
 * Shows `fallback` (the 2D map) if WebGL is unavailable.
 */
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

    let hovered: string | null = null;
    const setHover = (id: string | null) => {
      if (id === hovered) return;
      if (hovered) map.setFeatureState({ source: 'seg-blocks', id: hovered }, { hover: false });
      if (id) map.setFeatureState({ source: 'seg-blocks', id }, { hover: true });
      hovered = id;
      map.getCanvas().style.cursor = id ? 'pointer' : '';
    };
    const hitAt = (point: maplibregl.PointLike): string | null => {
      const f = map.queryRenderedFeatures(point, { layers: HIT_LAYERS })[0];
      return (f?.properties?.id as string) || null;
    };

    map.on('load', () => {
      const { segments: segs, selected: sel } = latest.current;
      const data = sources(segs, sel?.id);
      map.addSource('seg-lines', { type: 'geojson', data: data.lines });
      map.addSource('seg-blocks', { type: 'geojson', data: data.blocks, promoteId: 'id' });
      map.addSource('seg-labels', { type: 'geojson', data: data.labels });
      map.addSource('seg-ends', { type: 'geojson', data: data.ends });

      const layout = { 'line-cap': 'butt', 'line-join': 'round' } as const;
      map.addLayer({ id: 'seg-casing', type: 'line', source: 'seg-lines', layout, paint: { 'line-color': '#17233b', 'line-width': 12 } });
      map.addLayer({
        id: 'seg',
        type: 'line',
        source: 'seg-lines',
        layout,
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 9, 6] },
      });
      map.addLayer({
        id: 'seg-3d',
        type: 'fill-extrusion',
        source: 'seg-blocks',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['case', ['boolean', ['feature-state', 'hover'], false], RAISED_M, FLAT_M],
          'fill-extrusion-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'seg-ends',
        type: 'circle',
        source: 'seg-ends',
        paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#17233b', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'seg-labels',
        type: 'symbol',
        source: 'seg-labels',
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-offset': [0, -1.6], 'text-allow-overlap': true },
        paint: { 'text-color': '#17233b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });

      map.on('mousemove', e => setHover(hitAt(e.point)));
      map.on('mouseout', () => setHover(null));
      map.on('click', e => {
        const id = hitAt(e.point);
        const s = latest.current.segments.find(x => x.id === id);
        if (s) latest.current.onSelect(s);
      });

      const all = segs.flatMap(s => s.coords);
      if (all.length > 1) {
        map.fitBounds(boundsOf(all), { padding: 60, pitch: 60, bearing: -20, duration: 0 });
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
    if (!map?.getSource('seg-lines')) return;
    const data = sources(segments, selected?.id);
    (map.getSource('seg-lines') as maplibregl.GeoJSONSource).setData(data.lines);
    (map.getSource('seg-blocks') as maplibregl.GeoJSONSource).setData(data.blocks);
    (map.getSource('seg-labels') as maplibregl.GeoJSONSource).setData(data.labels);
    (map.getSource('seg-ends') as maplibregl.GeoJSONSource).setData(data.ends);
    const all = segments.flatMap(s => s.coords);
    if (!fitted.current && all.length > 1) {
      map.fitBounds(boundsOf(all), { padding: 60, pitch: 60, duration: 0 });
      fitted.current = true;
    }
  }, [segments, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && selected?.coords.length) map.fitBounds(boundsOf(selected.coords), { padding: 70, pitch: 60, duration: 800 });
  }, [selected]);

  if (failed) return <>{fallback}</>;
  return (
    <div
      ref={host}
      className="map3d"
      role="region"
      aria-label="3D road condition map. Hover a road segment to raise it, click it for details."
    />
  );
}
