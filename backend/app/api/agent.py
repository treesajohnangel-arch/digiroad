import os
import json
import logging
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

from app.api.routers.chat import fetch_database_snapshot, build_system_instruction

logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI Tool Agent"])


class ChatMessageInput(BaseModel):
    message: str = Field(..., example="What is the current health status of road segment SEG-102?")
    history: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Previous chat conversation history [{\"role\": \"user\"|\"assistant\"|\"model\", \"content\": \"...\"}]",
    )


class ChatMessageResponse(BaseModel):
    reply: str
    tool_calls: List[str] = Field(default_factory=list)
    timestamp: str


@router.post("/chat", response_model=ChatMessageResponse, status_code=status.HTTP_200_OK)
@router.post("", response_model=ChatMessageResponse, status_code=status.HTTP_200_OK)
@router.post("/", response_model=ChatMessageResponse, status_code=status.HTTP_200_OK)
async def chat_with_agent(payload: ChatMessageInput):
    """
    Connects to the Gemini AI assistant to answer queries regarding
    road network status, deterioration projections, and maintenance priorities.
    Dynamically queries Gemini on every request with live Supabase snapshot.
    """
    user_msg = payload.message.strip()
    if not user_msg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty.",
        )

    # 1. Fetch Supabase snapshot data
    snapshot_data = await fetch_database_snapshot()

    # 2. Build system instruction with persona and Supabase snapshot
    system_instruction = build_system_instruction(snapshot_data)

    # 3. Format history and current message into Gemini contents
    gemini_contents = []
    if payload.history:
        for msg in payload.history:
            role = "model" if msg.get("role") in ["assistant", "model"] else "user"
            content_text = msg.get("content", "")
            if content_text:
                gemini_contents.append(
                    types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=content_text)],
                    )
                )

    gemini_contents.append(
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=user_msg)],
        )
    )

    # 4. Initialize Gemini client with API key from environment
    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.4,
    )

    # 5. Dynamically query Gemini on every request
    primary_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    candidate_models = [primary_model, "gemini-3-flash-preview", "gemini-flash-latest"]
    seen = set()
    model_list = [m for m in candidate_models if not (m in seen or seen.add(m))]

    reply_text = ""
    last_error = None

    import time
    for model_name in model_list:
        for attempt in range(2):
            try:
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
            logger.error(f"Error querying Gemini API in agent router: {last_error}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Gemini API generation error: {str(last_error)}",
            )
        reply_text = "No response generated."

    return ChatMessageResponse(
        reply=reply_text,
        tool_calls=[],
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
