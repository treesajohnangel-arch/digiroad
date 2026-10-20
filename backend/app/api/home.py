import re
import logging
from typing import Dict, Any, List
from fastapi import APIRouter, Query
from app.services.decay_model import calculate_road_health, get_health_color_hex
from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Home & Map"])

# Default sample road segment dataset matching database segments exactly (MDR47 S01, S02, S03)
MOCK_ROAD_SEGMENTS: List[Dict[str, Any]] = [
    {
        "segment_id": "MDR47-S01",
        "road_name": "Vembayam - Pallipuram Road (MDR47 S01)",
        "chainage": "0.0 - 1.0 km",
        "cracking_pct": 22.48,
        "rut_depth_mm": 4.2,
        "raveling_pct": 8.59,
        "patching_pct": 0.29,
        "iri_m_km": 1.98,
        "pothole_pct": 0.0,
        "pci_score": 47.0,
        "road_health": "Very Poor",
        "color_hex": "#991B1B",
        "coordinates": [
            [76.9242, 8.6281],
            [76.9160, 8.6225],
        ],
    },
    {
        "segment_id": "MDR47-S02",
        "road_name": "Vembayam - Pallipuram Road (MDR47 S02)",
        "chainage": "1.0 - 2.0 km",
        "cracking_pct": 26.97,
        "rut_depth_mm": 5.1,
        "raveling_pct": 8.59,
        "patching_pct": 0.36,
        "iri_m_km": 2.04,
        "pothole_pct": 0.0,
        "pci_score": 40.0,
        "road_health": "Very Poor",
        "color_hex": "#991B1B",
        "coordinates": [
            [76.9160, 8.6225],
            [76.9079, 8.6170],
        ],
    },
    {
        "segment_id": "MDR47-S03",
        "road_name": "Vembayam - Pallipuram Road (MDR47 S03)",
        "chainage": "2.0 - 3.0 km",
        "cracking_pct": 33.12,
        "rut_depth_mm": 6.3,
        "raveling_pct": 8.59,
        "patching_pct": 0.45,
        "iri_m_km": 2.06,
        "pothole_pct": 0.0,
        "pci_score": 30.0,
        "road_health": "Very Poor",
        "color_hex": "#991B1B",
        "coordinates": [
            [76.9079, 8.6170],
            [76.8998, 8.6115],
        ],
    },
]


def _format_display_name(segment_id: str, road_name: str) -> str:
    """Format segment with standardized display name like MDR47 S01."""
    clean_seg = segment_id.replace("-", " ")
    if clean_seg.lower() in road_name.lower():
        return road_name
    return f"{road_name} ({clean_seg})"


@router.get("/map-data")
async def get_map_data():
    """
    Returns pavement condition GeoJSON FeatureCollection including:
    cracking_pct, rut_depth_mm, raveling_pct, patching_pct, iri_m_km, pothole_pct,
    pci_score, road_health, and color hexes.
    Pulls live dynamic condition from dynamic_road_evaluations to avoid any hardcoded PCI.
    """
    features = []

    segments = MOCK_ROAD_SEGMENTS
    dynamic_map: Dict[str, Dict[str, Any]] = {}

    if supabase:
        try:
            res_seg = supabase.table("road_segments").select("*").execute()
            if res_seg.data and len(res_seg.data) > 0:
                segments = res_seg.data

            # Fetch live dynamic road evaluation table data (daily dynamic calculations)
            res_eval = supabase.table("dynamic_road_evaluations").select("*").execute()
            if res_eval.data:
                for row in res_eval.data:
                    sid = row.get("segment_id")
                    if sid:
                        dynamic_map[sid] = row
                        dynamic_map[sid.replace("-", " ")] = row
        except Exception as e:
            logger.warning(f"Error fetching segments/evaluations from Supabase: {e}")

    for seg in segments:
        seg_id = seg.get("segment_id", "")
        dyn = dynamic_map.get(seg_id) or dynamic_map.get(seg_id.replace("-", " ")) or {}

        # PCI value dynamically taken from dynamic_road_evaluations table
        if dyn.get("pci_score") is not None:
            pci = float(dyn["pci_score"])
        elif seg.get("pci_score") is not None:
            pci = float(seg["pci_score"])
        else:
            pci = 100.0

        # Road health is dynamically computed from this calculated PCI score
        health = dyn.get("road_health") or calculate_road_health(pci)
        color = get_health_color_hex(health)

        # Distresses from dynamic evaluation table
        cracking_pct = float(dyn.get("cracking_pct") if dyn.get("cracking_pct") is not None else seg.get("cracking_pct", 0.0))
        raveling_pct = float(dyn.get("raveling_pct") if dyn.get("raveling_pct") is not None else seg.get("raveling_pct", 0.0))
        patching_pct = float(dyn.get("patching_pct") if dyn.get("patching_pct") is not None else seg.get("patching_pct", 0.0))
        iri_m_km = float(dyn.get("iri_m_km") if dyn.get("iri_m_km") is not None else seg.get("iri_m_km", 1.2))
        pothole_pct = float(dyn.get("pothole_pct") if dyn.get("pothole_pct") is not None else seg.get("pothole_pct", 0.0))
        rut_depth_mm = float(dyn.get("rut_depth_mm", dyn.get("rutting_mm", seg.get("rut_depth_mm", 0.0))))

        coords = seg.get("coordinates")
        if not coords:
            s_lat, s_lon = seg.get("start_lat"), seg.get("start_lon")
            e_lat, e_lon = seg.get("end_lat"), seg.get("end_lon")
            if None not in (s_lat, s_lon, e_lat, e_lon):
                coords = [[float(s_lon), float(s_lat)], [float(e_lon), float(e_lat)]]
            else:
                coords = [[76.9242, 8.6281], [76.9160, 8.6225]]

        base_road_name = seg.get("road_name") or f"Road {seg_id}"
        display_road_name = _format_display_name(seg_id, base_road_name)

        feature = {
            "type": "Feature",
            "properties": {
                "segment_id": seg_id,
                "segment_name": seg_id.replace("-", " "),
                "road_name": display_road_name,
                "chainage": seg.get("chainage", ""),
                "cracking_pct": cracking_pct,
                "rut_depth_mm": rut_depth_mm,
                "raveling_pct": raveling_pct,
                "patching_pct": patching_pct,
                "iri_m_km": iri_m_km,
                "pothole_pct": pothole_pct,
                "pci_score": pci,
                "road_health": health,
                "color_hex": color,
            },
            "geometry": {
                "type": "LineString",
                "coordinates": coords,
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def _normalize_search_key(text: str) -> str:
    """Normalize text by stripping spaces, hyphens, and underscores for flexible search matching."""
    return re.sub(r"[\s\-_]+", "", text or "").lower()


@router.get("/search")
async def search_segments(q: str = Query(..., min_length=1, description="Search query for segment ID or road name")):
    """
    Search for road segments by name or segment_id across the database.
    Fetches real records dynamically from Supabase road_segments and dynamic_road_evaluations.
    Returns only matching records with real database values.
    """
    raw_query = q.strip()
    query_norm = _normalize_search_key(raw_query)
    query_tokens = [t.lower() for t in re.split(r"[\s\-_]+", raw_query) if t]
    results = []

    segments: List[Dict[str, Any]] = []
    dynamic_map: Dict[str, Dict[str, Any]] = {}

    if supabase is not None:
        try:
            res_seg = supabase.table("road_segments").select("*").execute()
            if res_seg.data:
                segments = res_seg.data

            res_eval = supabase.table("dynamic_road_evaluations").select("*").execute()
            if res_eval.data:
                for row in res_eval.data:
                    sid = row.get("segment_id")
                    if sid:
                        dynamic_map[sid] = row
                        dynamic_map[sid.replace("-", " ")] = row
        except Exception as e:
            logger.warning(f"Error searching segments from Supabase: {e}")
            segments = []
    else:
        # Offline development mode only
        segments = MOCK_ROAD_SEGMENTS

    for seg in segments:
        sid = seg.get("segment_id", "")
        rname = seg.get("road_name", "")
        chainage = seg.get("chainage", "")
        display_road_name = _format_display_name(sid, rname or f"Road {sid}")

        sid_norm = _normalize_search_key(sid)
        rname_norm = _normalize_search_key(rname)
        display_norm = _normalize_search_key(display_road_name)

        # Match normalized key (e.g., 'mdr47' matches 'mdr47s01', 'vembayam' matches 'vembayampallipuramroad')
        # or match if all search tokens appear in the segment ID or road name
        matches = (
            query_norm in sid_norm
            or query_norm in rname_norm
            or query_norm in display_norm
            or (query_tokens and all(
                t in sid.lower() or t in rname.lower() or t in display_road_name.lower() or t in chainage.lower()
                for t in query_tokens
            ))
        )

        if matches:
            dyn = dynamic_map.get(sid) or dynamic_map.get(sid.replace("-", " ")) or {}
            if dyn.get("pci_score") is not None:
                pci = float(dyn["pci_score"])
            elif seg.get("pci_score") is not None:
                pci = float(seg["pci_score"])
            else:
                pci = 100.0

            health = dyn.get("road_health") or calculate_road_health(pci)
            color = get_health_color_hex(health)

            results.append({
                "segment_id": sid,
                "segment_name": sid.replace("-", " "),
                "road_name": display_road_name,
                "chainage": chainage,
                "cracking_pct": float(dyn.get("cracking_pct") if dyn.get("cracking_pct") is not None else seg.get("cracking_pct", 0.0)),
                "rut_depth_mm": float(dyn.get("rut_depth_mm", dyn.get("rutting_mm", seg.get("rut_depth_mm", 0.0)))),
                "raveling_pct": float(dyn.get("raveling_pct") if dyn.get("raveling_pct") is not None else seg.get("raveling_pct", 0.0)),
                "patching_pct": float(dyn.get("patching_pct") if dyn.get("patching_pct") is not None else seg.get("patching_pct", 0.0)),
                "iri_m_km": float(dyn.get("iri_m_km") if dyn.get("iri_m_km") is not None else seg.get("iri_m_km", 1.2)),
                "pothole_pct": float(dyn.get("pothole_pct") if dyn.get("pothole_pct") is not None else seg.get("pothole_pct", 0.0)),
                "pci_score": pci,
                "road_health": health,
                "color_hex": color,
            })

    return {
        "query": q,
        "count": len(results),
        "results": results,
    }

