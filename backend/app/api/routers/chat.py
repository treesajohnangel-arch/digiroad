import os
import json
import asyncio
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(tags=["PaveBot Chat"])

# Citizen identity fields never leave the backend through the chatbot (endpoint is public).
PII_FIELDS = {"citizen_name", "contact", "email", "phone", "phone_number", "user_id", "created_by", "reporter_id"}
PAGE_SIZE = 1000
MAX_ROWS_PER_TABLE = 50000
TIMESTAMP_FIELDS = ("evaluation_timestamp", "execution_timestamp", "updated_at", "created_at")
METRIC_FIELDS = ("pci_score", "iri_m_km", "cracking_pct", "raveling_pct", "patching_pct", "pothole_pct", "rut_depth_mm")


# ---------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------
class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of message sender: 'user' or 'assistant'")
    content: str = Field(..., description="Text content of the message")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User query or message")
    history: List[ChatMessage] = Field(default_factory=list, description="Conversation history")


class ChatResponse(BaseModel):
    reply: str = Field(..., description="Assistant reply message")
    history: List[ChatMessage] = Field(..., description="Updated conversation history")


# ---------------------------------------------------------
# Database snapshot: every row of every road/complaint table
# ---------------------------------------------------------
def _fetch_all_rows(table: str) -> List[Dict[str, Any]]:
    """Read a whole table, paging past Supabase's 1000-row response cap."""
    rows: List[Dict[str, Any]] = []
    start = 0
    while start < MAX_ROWS_PER_TABLE:
        res = supabase.table(table).select("*").range(start, start + PAGE_SIZE - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


def _row_time(row: Dict[str, Any]) -> str:
    for field in TIMESTAMP_FIELDS:
        if row.get(field):
            return str(row[field])
    return ""


def _num(value: Any) -> Optional[float]:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _strip_pii(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in row.items() if k not in PII_FIELDS}


def _summarize_evaluations(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Per segment: row count, date range, first/latest full rows, and monthly metric averages."""
    by_segment: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_segment[str(row.get("segment_id") or "unknown")].append(row)

    summary: Dict[str, Any] = {}
    for seg_id, seg_rows in sorted(by_segment.items()):
        seg_rows.sort(key=_row_time)
        monthly: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
        for row in seg_rows:
            month = _row_time(row)[:7] or "undated"
            for field in METRIC_FIELDS:
                value = _num(row.get(field))
                if value is not None:
                    monthly[month][field].append(value)
        summary[seg_id] = {
            "row_count": len(seg_rows),
            "first_date": _row_time(seg_rows[0]),
            "latest_date": _row_time(seg_rows[-1]),
            "first_row": seg_rows[0],
            "latest_row": seg_rows[-1],
            "monthly_averages": {
                month: {
                    field: {"avg": round(sum(v) / len(v), 2), "min": min(v), "max": max(v)}
                    for field, v in fields.items()
                }
                for month, fields in sorted(monthly.items())
            },
        }
    return summary


def _summarize_complaints(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    def norm_status(row: Dict[str, Any]) -> str:
        return str(row.get("status") or "nil").strip().lower()

    per_segment: Dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        per_segment[str(row.get("segment_id") or "unknown")][norm_status(row)] += 1
    return {
        "total": len(rows),
        "by_status": dict(Counter(norm_status(r) for r in rows)),
        "by_severity": dict(Counter(str(r.get("severity") or "unknown") for r in rows)),
        "by_category": dict(Counter(str(r.get("complaint_heading") or "unknown") for r in rows)),
        "by_segment_and_status": {seg: dict(c) for seg, c in sorted(per_segment.items())},
    }


async def fetch_database_snapshot() -> Dict[str, Any]:
    """
    Load the full DigiRoad dataset from Supabase: road_segments, dynamic_road_evaluations,
    historic_road_evaluations and user_complaints (citizen identity removed), plus summaries.
    Never substitutes invented data: failures are reported in `database_status`.
    """
    snapshot: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database_status": "ok",
        "errors": {},
    }

    if supabase is None:
        snapshot["database_status"] = "unavailable: Supabase client is not configured"
        return snapshot

    tables = ("road_segments", "dynamic_road_evaluations", "historic_road_evaluations", "user_complaints")

    def _sync_fetch() -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        for table in tables:
            try:
                data[table] = _fetch_all_rows(table)
            except Exception as e:
                logger.warning("PaveBot failed to read %s: %s", table, e)
                snapshot["errors"][table] = str(e)
                data[table] = []
        return data

    try:
        data = await asyncio.wait_for(asyncio.to_thread(_sync_fetch), timeout=25.0)
    except Exception as e:
        logger.warning("PaveBot database snapshot failed: %s", e)
        snapshot["database_status"] = f"unavailable: {e}"
        return snapshot

    complaints = [_strip_pii(r) for r in data["user_complaints"]]
    complaints.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    dynamic_rows = data["dynamic_road_evaluations"]
    historic_rows = data["historic_road_evaluations"]

    snapshot["row_counts"] = {table: len(data[table]) for table in tables}
    snapshot["road_segments"] = data["road_segments"]
    snapshot["dynamic_road_evaluations_summary"] = _summarize_evaluations(dynamic_rows)
    # Small tables go in whole; large ones are represented by the per-segment summary above.
    if len(dynamic_rows) <= 300:
        snapshot["dynamic_road_evaluations"] = sorted(dynamic_rows, key=_row_time)
    snapshot["historic_road_evaluations_summary"] = _summarize_evaluations(historic_rows)
    snapshot["user_complaints_summary"] = _summarize_complaints(complaints)
    snapshot["user_complaints"] = complaints
    if snapshot["errors"]:
        snapshot["database_status"] = "partial: some tables could not be read"
    return snapshot


# ---------------------------------------------------------
# System instruction
# ---------------------------------------------------------
def build_system_instruction(snapshot_data: Dict[str, Any]) -> str:
    snapshot_json = json.dumps(snapshot_data, default=str, separators=(",", ":"))

    return f"""You are "PaveBot", the Pavement Management System (PMS) copilot of the DigiRoad platform.
You serve road engineers, planners and citizens for the Vembayam - Pallipuram Road (MDR47) corridor in
Thiruvananthapuram, Kerala, split into segments MDR47-S01, MDR47-S02 and MDR47-S03 (about 1 km each).

## How to answer
1. Answer every part of the question completely. Give exact figures from the dataset (PCI, IRI, distress
   percentages, rut depth, dates, complaint counts and IDs), name the segment, and state the date of the data.
2. Base every factual claim about roads or complaints on the DATASET below. Compute totals, averages,
   rankings, comparisons and trends from it yourself. Never invent segments, readings or complaints.
3. If the dataset lacks what is asked, or `database_status` is not "ok", say so plainly and say what is missing.
4. After the facts, add a short engineering interpretation and a recommended action when relevant.
5. Map loose names to IDs: "segment 1", "S1", "first segment" -> MDR47-S01, and so on.
6. Handle typos and informal phrasing without comment. Answer in the user's language.
7. Format for a narrow plain-text chat panel: short paragraphs and "-" bullet lists. Do not use markdown
   tables, headings, or ** bold markers.

## Data meaning
- road_segments: master record per segment (name, chainage, coordinates, baseline condition).
- dynamic_road_evaluations: current/latest computed condition per segment. Its `latest_row` per segment in
  the summary is the CURRENT condition; prefer it over road_segments for "now" questions.
- historic_road_evaluations: past evaluations over time. Use `monthly_averages`, `first_row` and
  `latest_row` for trends, deterioration rate and history questions.
- user_complaints: citizen complaints (identities removed). Statuses: "nil" = new/pending,
  "under process" = repair in progress, "repaired" = closed. Use `user_complaints_summary` for counts.

## Domain knowledge
- PCI (0-100) health bands used by DigiRoad: >= 85 Good, 70-84.99 Fair, 55-69.99 Poor, < 55 Very Poor.
  If a row has `road_health`, report that value.
- IRI (m/km): < 2.0 smooth, 2.0-4.0 moderate roughness, > 4.0 rough.
- Distresses: cracking (fatigue/alligator, longitudinal, transverse), rutting (wheel-path depressions),
  potholes (moisture plus traffic), raveling (aggregate loss), patching (past repair areas).
- Interventions: PCI 70-85 preventive maintenance (crack sealing, fog seal, micro-surfacing);
  PCI 40-69 rehabilitation (milling and HMA overlay, deep patching, cold in-place recycling);
  PCI < 40 full reconstruction. Monsoon rainfall, heavy traffic and delayed repair speed up decay;
  delaying repair until reconstruction can cost 4-5x more.
- For what-if or forecast questions, extrapolate from the historic trend in the dataset and say it is an estimate.

## DATASET (live from Supabase, generated {snapshot_data.get("generated_at")})
{snapshot_json}
"""


# ---------------------------------------------------------
# Gemini call with model discovery
# ---------------------------------------------------------
def _generate_reply(client: genai.Client, contents: List[types.Content], config: types.GenerateContentConfig) -> str:
    """Try the configured model and stable aliases, then any available flash model. Raise with every error."""
    candidates = [os.getenv("GEMINI_MODEL", ""), "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"]
    tried: List[str] = []
    errors: List[str] = []

    def attempt(model_name: str) -> str:
        tried.append(model_name)
        try:
            response = client.models.generate_content(model=model_name, contents=contents, config=config)
            return (response.text or "").strip() if response else ""
        except Exception as e:
            errors.append(f"{model_name}: {e}")
            logger.warning("PaveBot model %s failed: %s", model_name, e)
            return ""

    for name in candidates:
        if name and name not in tried:
            reply = attempt(name)
            if reply:
                return reply

    # Configured names failed: ask the API which models this key can use.
    try:
        available = [
            m.name.removeprefix("models/")
            for m in client.models.list()
            if "generateContent" in (getattr(m, "supported_actions", None) or [])
            and "flash" in (m.name or "")
        ]
    except Exception as e:
        errors.append(f"list models: {e}")
        available = []
    for name in sorted(available, reverse=True)[:4]:
        if name not in tried:
            reply = attempt(name)
            if reply:
                return reply

    raise RuntimeError("; ".join(errors) or "No model returned a reply.")


# ---------------------------------------------------------
# API Route: POST /api/chat
# ---------------------------------------------------------
@router.post("/api/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
@router.post("/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """PaveBot: answers from the full live Supabase dataset using Gemini."""
    user_msg = request.message.strip()
    if not user_msg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message content cannot be empty.")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your-gemini-api-key":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="GEMINI_API_KEY is not configured on the server.")

    snapshot_data = await fetch_database_snapshot()
    config = types.GenerateContentConfig(
        system_instruction=build_system_instruction(snapshot_data),
        temperature=0.3,
    )

    contents = [
        types.Content(role="model" if m.role == "assistant" else "user", parts=[types.Part.from_text(text=m.content)])
        for m in request.history[-20:]
    ]
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_msg)]))

    try:
        reply_text = await asyncio.to_thread(_generate_reply, genai.Client(api_key=api_key), contents, config)
    except Exception as e:
        logger.error("PaveBot generation failed: %s", e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Gemini API generation error: {e}")

    updated_history = list(request.history)
    updated_history.append(ChatMessage(role="user", content=user_msg))
    updated_history.append(ChatMessage(role="assistant", content=reply_text))
    return ChatResponse(reply=reply_text, history=updated_history)
