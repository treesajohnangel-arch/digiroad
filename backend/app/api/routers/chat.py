import os
import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(tags=["PaveBot Chat"])


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
# Helper: Fetch Supabase Snapshot
# ---------------------------------------------------------
async def fetch_database_snapshot() -> Dict[str, Any]:
    """
    Fetches snapshot data from Supabase tables:
    - road_segments
    - dynamic_road_evaluations
    - user_complaints
    Falls back gracefully if database queries encounter any errors or timeout.
    """
    snapshot: Dict[str, Any] = {
        "road_segments": [],
        "dynamic_road_evaluations": [],
        "user_complaints": [],
    }

    if supabase is None:
        logger.warning("Supabase client is not available for snapshot retrieval.")
        return _get_fallback_snapshot()

    def _sync_fetch() -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        try:
            res_segments = supabase.table("road_segments").select("*").limit(25).execute()
            if res_segments.data:
                data["road_segments"] = res_segments.data
        except Exception as e:
            logger.warning("Failed to fetch snapshot from road_segments: %s", e)

        try:
            res_evals = (
                supabase.table("dynamic_road_evaluations")
                .select("*")
                .order("execution_timestamp", desc=True)
                .limit(25)
                .execute()
            )
            if res_evals.data:
                data["dynamic_road_evaluations"] = res_evals.data
        except Exception:
            try:
                res_evals = supabase.table("dynamic_road_evaluations").select("*").limit(25).execute()
                if res_evals.data:
                    data["dynamic_road_evaluations"] = res_evals.data
            except Exception:
                pass

        try:
            res_complaints = (
                supabase.table("user_complaints")
                .select("*")
                .order("created_at", desc=True)
                .limit(25)
                .execute()
            )
            if res_complaints.data:
                data["user_complaints"] = res_complaints.data
        except Exception as e:
            logger.warning("Failed to fetch snapshot from user_complaints: %s", e)
        return data

    import asyncio
    try:
        live_data = await asyncio.wait_for(asyncio.to_thread(_sync_fetch), timeout=7.0)
        snapshot.update(live_data)
    except Exception as e:
        logger.warning("Supabase snapshot retrieval timed out or failed: %s. Using baseline PMS fallback.", e)

    # If Supabase tables were empty or failed, supplement with baseline fallback data
    if not snapshot["road_segments"]:
        fallback = _get_fallback_snapshot()
        snapshot["road_segments"] = fallback["road_segments"]
        if not snapshot["dynamic_road_evaluations"]:
            snapshot["dynamic_road_evaluations"] = fallback["dynamic_road_evaluations"]
        if not snapshot["user_complaints"]:
            snapshot["user_complaints"] = fallback["user_complaints"]

    return snapshot


def _get_fallback_snapshot() -> Dict[str, Any]:
    """Returns baseline data for PMS reference if live DB is empty or disconnected."""
    return {
        "road_segments": [
            {
                "segment_id": "MDR47-S01",
                "road_name": "Vembayam - Pallipuram Road (MDR47 S01)",
                "chainage": "0.000 - 1.000 km",
                "pci_score": 100.0,
                "iri_m_km": 1.2,
                "cracking_pct": 0.0,
                "raveling_pct": 0.0,
                "patching_pct": 0.0,
                "pothole_pct": 0.0,
                "road_health": "Good",
            },
            {
                "segment_id": "MDR47-S02",
                "road_name": "Vembayam - Pallipuram Road (MDR47 S02)",
                "chainage": "1.000 - 2.000 km",
                "pci_score": 100.0,
                "iri_m_km": 1.2,
                "cracking_pct": 0.0,
                "raveling_pct": 0.0,
                "patching_pct": 0.0,
                "pothole_pct": 0.0,
                "road_health": "Good",
            },
            {
                "segment_id": "MDR47-S03",
                "road_name": "Vembayam - Pallipuram Road (MDR47 S03)",
                "chainage": "2.000 - 3.000 km",
                "pci_score": 30.0,
                "iri_m_km": 4.5,
                "cracking_pct": 28.5,
                "raveling_pct": 18.0,
                "patching_pct": 14.5,
                "pothole_pct": 5.8,
                "road_health": "Very Poor",
            },
        ],
        "dynamic_road_evaluations": [
            {
                "segment_id": "MDR47-S01",
                "pci_score": 100.0,
                "iri_m_km": 1.2,
                "road_health": "Good",
            },
            {
                "segment_id": "MDR47-S02",
                "pci_score": 100.0,
                "iri_m_km": 1.2,
                "road_health": "Good",
            },
            {
                "segment_id": "MDR47-S03",
                "pci_score": 30.0,
                "iri_m_km": 4.5,
                "road_health": "Very Poor",
            },
        ],
        "user_complaints": [],
    }


# ---------------------------------------------------------
# Helper: Build System Instruction
# ---------------------------------------------------------
def build_system_instruction(snapshot_data: Dict[str, Any]) -> str:
    """
    Builds the detailed system instruction for PaveBot incorporating
    persona, knowledge, decision rules, reasoning, behavior, and the Supabase snapshot.
    """
    snapshot_json = json.dumps(snapshot_data, indent=2, default=str)

    instruction = f"""You are "PaveBot", an expert Pavement Management System (PMS) AI assistant for the DigiRoad platform.

### Core Persona & Mission:
- You are knowledgeable, professional, conversational, and highly helpful.
- You assist municipal highway engineers, city planners, and citizens in understanding road health conditions, deterioration mechanics, and infrastructure maintenance decisions.

### Knowledge Base:
1. **PCI (Pavement Condition Index)**: A standard numerical rating between 0 and 100 reflecting the structural integrity and surface condition of a road:
   - 85–100: Good / Excellent condition. Minimal or negligible surface defects.
   - 70–84: Satisfactory / Fair condition. Minor superficial distress.
   - 40–69: Poor / Fair condition with significant structural deterioration.
   - 0–39: Very Poor / Failed / Critical condition. Structural failure.
2. **IRI (International Roughness Index, m/km)**: Measures longitudinal road roughness and ride quality:
   - < 2.0 m/km: Smooth ride quality (high user satisfaction).
   - 2.0 – 4.0 m/km: Moderate roughness (noticeable vibrations).
   - > 4.0 m/km: Rough/severe roughness (discomfort, vehicle wear).
3. **Pavement Distress Types**:
   - Cracking: Fatigue/alligator cracking (load-related base failure), longitudinal, transverse, block cracking.
   - Rutting: Depressions in wheel paths due to subgrade or asphalt deformation.
   - Potholes: Bowl-shaped holes caused by moisture intrusion followed by freeze-thaw or traffic stress.
   - Raveling & Weathering: Dislodgement of aggregate particles and loss of binder.
   - Patching: Existing repair areas indicating historical distress points.
4. **Citizen Complaints**:
   - Statuses: PENDING, UNDER_PROCESS, REPAIRED.
   - Citizen feedback provides real-time community ground-truth for rapid maintenance dispatching.

### Decision Rules for Interventions:
- **PCI 70 – 85**: Recommend **Preventive Fixes** (e.g., crack sealing, fog seal, micro-surfacing, thin slurry seal) to preserve pavement and stop moisture penetration before structural damage occurs.
- **PCI 40 – 69**: Recommend **Rehabilitation** (e.g., structural milling, cold in-place recycling, hot-mix asphalt (HMA) overlay, deep patch repairs).
- **PCI Drops Below 40 (< 40)**: Recommend **Full Reconstruction** (complete removal of surface and base courses, subgrade stabilization, full repaving). Emphasize that surface patching is no longer cost-effective or safe at this stage.

### Analytical Reasoning & Scenario Handling:
- **What-If Scenarios & Future Predictions**: Capably project pavement decay over 1–5 years using deterioration models. Explain how factors like heavy monsoon rainfall (increased moisture ingress weakening CBR), high traffic volume (heavy commercial ESAL loading), and delayed maintenance accelerate degradation exponentially (e.g., delaying repairs for 2 years can multiply rehabilitation costs by 4x to 5x when a road slips into full reconstruction).
- Map user queries mentioning segment names or numbers (e.g., "Segment 101" or "Segment 102") to matching identifiers (e.g., "SEG-101", "SEG-102") from the database snapshot.

### Conversational Behavior:
- Gracefully handle typos, informal phrasing, or broken grammar without being pedantic.
- Respond with clear, structured explanations (using markdown bullet points and bold highlights when appropriate).
- Maintain an encouraging, authoritative, and helpful conversational tone.

### Live DigiRoad Database Snapshot:
Below is the current snapshot of road segments, dynamic evaluations, and citizen complaints:
```json
{snapshot_json}
```

Use this live snapshot data whenever the user asks about specific road segments, conditions, or complaints.
"""
    return instruction


# ---------------------------------------------------------
# API Route: POST /api/chat
# ---------------------------------------------------------
@router.post("/api/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
@router.post("/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """
    Chat endpoint for DigiRoad AI PaveBot.
    - Receives user message and chat history.
    - Fetches snapshot from Supabase (road_segments, dynamic_road_evaluations, user_complaints).
    - Initializes google-genai Client with GEMINI_API_KEY.
    - Configures system instructions incorporating persona and database snapshot.
    - Invokes Gemini 2.0 Flash model.
    - Returns updated history with assistant reply.
    """
    user_msg = request.message.strip()
    if not user_msg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty.",
        )

    # 1. Fetch Supabase Database Snapshot
    snapshot_data = await fetch_database_snapshot()

    # 2. Build System Instruction with Persona and Snapshot Data
    system_instruction = build_system_instruction(snapshot_data)

    # 3. Format Conversation History into Gemini Contents
    gemini_contents = []
    for msg in request.history:
        role = "model" if msg.role == "assistant" else "user"
        gemini_contents.append(
            types.Content(
                role=role,
                parts=[types.Part.from_text(text=msg.content)],
            )
        )

    # Append current user message
    gemini_contents.append(
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=user_msg)],
        )
    )

    # 4. Initialize Gemini Client & Dynamically Generate Response
    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.4,
    )

    primary_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    candidate_models = [primary_model, "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-3-flash-preview"]
    seen = set()
    model_list = [m for m in candidate_models if not (m in seen or seen.add(m))]

    reply_text = ""
    last_error = None

    import time
    for model_name in model_list:
        for attempt in range(2):
            try:
                logger.info(f"Generating content with model {model_name} (attempt {attempt+1})...")
                response = client.models.generate_content(
                    model=model_name,
                    contents=gemini_contents,
                    config=config,
                )
                if response and response.text:
                    reply_text = response.text
                    break
            except Exception as e:
                last_error = e
                err_str = str(e).lower()
                if "503" in err_str or "unavailable" in err_str or "high demand" in err_str:
                    logger.warning(f"Model {model_name} hit 503 high demand: {e}. Retrying/falling back...")
                    time.sleep(1.0)
                    continue
                break
        if reply_text:
            break

    if not reply_text:
        if last_error:
            logger.error(f"Error querying Gemini API across candidate models: {last_error}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Gemini API generation error: {str(last_error)}",
            )
        reply_text = "No response generated."

    # 5. Append Assistant Reply to History
    updated_history = list(request.history)
    updated_history.append(ChatMessage(role="user", content=user_msg))
    updated_history.append(ChatMessage(role="assistant", content=reply_text))

    return ChatResponse(reply=reply_text, history=updated_history)
