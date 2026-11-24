from enum import Enum
from typing import Optional, Any, Literal
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class ComplaintStatus(str, Enum):
    NIL = "nil"
    UNDER_PROCESS = "under process"
    REPAIRED = "repaired"
    PENDING = "pending"


class ComplaintCreate(BaseModel):
    segment_id: str = Field(..., description="Unique identifier for the road segment")
    complaint_heading: Optional[str] = Field("Road Complaint", description="Brief heading or issue category")
    description: str = Field(..., description="Detailed description of the road issue (max 100 words)")
    citizen_name: Optional[str] = None
    contact: Optional[str] = None
    severity: Optional[str] = None
    consent: bool = Field(False, description="Citizen agreed to the privacy notice")
    website: Optional[str] = Field(None, description="Honeypot: real users never fill this hidden field")
    photo_base64: Optional[str] = Field(None, max_length=1_500_000, description="Optional JPEG/PNG photo, base64 or data URL, max 1 MB decoded")
    latitude: Optional[float] = Field(None, ge=-90, le=90, description="Exact damage location (pin, GPS or photo geotag)")
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class ComplaintFeedback(BaseModel):
    fixed: bool = Field(..., description="Citizen says the road is fixed")
    comment: Optional[str] = Field(None, max_length=300)


class ComplaintPriority(BaseModel):
    priority: Literal["P1", "P2", "P3", "P4"]


class ComplaintResponse(BaseModel):
    complaint_id: str
    segment_id: str
    complaint_heading: Optional[str] = "Road Complaint"
    description: str
    status: str = "nil"
    created_at: Optional[str] = None
    repaired_at: Optional[str] = None
    repair_type: Optional[str] = None
    citizen_name: Optional[str] = None
    contact: Optional[str] = None
    severity: Optional[str] = None
    photo_url: Optional[str] = None
    priority: Optional[str] = None
    priority_source: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @field_validator("complaint_id", mode="before")
    @classmethod
    def serialize_complaint_id(cls, v: Any) -> str:
        return str(v)

    @field_validator("created_at", "repaired_at", mode="before")
    @classmethod
    def serialize_datetime(cls, v: Any) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, datetime):
            return v.isoformat()
        return str(v)

    class Config:
        from_attributes = True


ComplaintSchema = ComplaintResponse
Complaint = ComplaintResponse

__all__ = [
    "ComplaintStatus",
    "ComplaintCreate",
    "ComplaintResponse",
    "ComplaintSchema",
    "Complaint",
]
