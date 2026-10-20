from enum import Enum
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class ComplaintStatus(str, Enum):
    UNDER_PROCESS = "UNDER_PROCESS"
    REPAIRED = "REPAIRED"
    PENDING = "PENDING"


class ComplaintCreate(BaseModel):
    segment_id: str = Field(..., description="Unique identifier for the road segment")
    complaint_heading: Optional[str] = Field("Road Complaint", description="Brief heading or issue category")
    description: str = Field(..., description="Detailed description of the road issue (max 100 words)")


class ComplaintResponse(BaseModel):
    complaint_id: str
    segment_id: str
    complaint_heading: Optional[str] = "Road Complaint"
    description: str
    status: str = "UNDER_PROCESS"
    created_at: Optional[str] = None
    repaired_at: Optional[str] = None

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
