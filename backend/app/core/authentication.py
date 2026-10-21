import logging
from typing import Dict, Any, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

from app.config import settings
from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


def verify_jwt_token(token: str) -> Dict[str, Any]:
    """
    Verifies incoming JWT Bearer token:
    1. If SUPABASE_JWT_SECRET is configured, validates signature and claims.
    2. Also validates or falls back to Supabase Auth's user session check.
    Returns the decoded claims dictionary with 'sub' (user_id) and 'email'.
    """
    claims: Optional[Dict[str, Any]] = None

    # 1. Try decoding with SUPABASE_JWT_SECRET if provided
    jwt_secret = settings.SUPABASE_JWT_SECRET.strip() if settings.SUPABASE_JWT_SECRET else ""
    if jwt_secret:
        try:
            claims = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256", "ES256", "HS384", "HS512"],
                options={"verify_aud": False},
            )
        except jwt.PyJWTError as e:
            logger.debug("JWT decode with secret failed: %s", e)
            claims = None

    # 2. Validate with Supabase Auth service if available
    if supabase is not None:
        try:
            user_response = supabase.auth.get_user(token)
            if user_response and user_response.user:
                sb_user = user_response.user
                if claims is None:
                    # Parse unverified claims or construct from user response
                    try:
                        claims = jwt.decode(token, options={"verify_signature": False})
                    except Exception:
                        claims = {}
                claims["sub"] = sb_user.id
                claims["email"] = sb_user.email or claims.get("email")
                return claims
        except Exception as e:
            logger.debug("Supabase auth.get_user failed: %s", e)
            # If secret-based validation already succeeded, we can proceed
            if claims is not None and "sub" in claims:
                return claims

    # If claims were verified via secret
    if claims is not None and "sub" in claims:
        return claims

    # Mock mode token fallback for local development if Supabase is offline
    if supabase is None:
        try:
            claims = jwt.decode(token, options={"verify_signature": False})
            if "sub" in claims:
                return claims
        except Exception:
            pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """
    FastAPI dependency that extracts and verifies incoming JWT Bearer tokens,
    looks up the user profile from public.profiles, and returns the user profile
    including normalized role ('public' or 'admin').
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    if supabase is None and token in ["demo-admin-token", "demo-user-token", "demo-token"]:
        is_admin = token == "demo-admin-token"
        return {
            "id": "demo-admin-id" if is_admin else "demo-user-id",
            "email": "admin@digiroad.gov" if is_admin else "engineer@digiroad.local",
            "full_name": "Demo Administrator" if is_admin else "Demo Engineer",
            "role": "admin" if is_admin else "public",
        }

    claims = verify_jwt_token(token)
    user_id = claims.get("sub")
    user_email = claims.get("email", "")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload: missing subject identifier",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Query public.profiles using the user's id from the decoded JWT
    profile: Optional[Dict[str, Any]] = None
    if supabase is not None:
        try:
            res = supabase.table("profiles").select("*").eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                profile = res.data[0]
        except Exception as e:
            logger.error("Failed to query public.profiles for user %s: %s", user_id, e)

    if profile is None:
        # Fallback profile record if not found in table yet
        meta = claims.get("user_metadata", {})
        profile = {
            "id": user_id,
            "email": user_email,
            "full_name": meta.get("full_name") or claims.get("name") or "User",
            "role": "public",
        }

    # Normalize role: in Postgres enum 'user' is stored, map to 'public' for DigiRoad RBAC
    raw_role = (profile.get("role") or "public").strip().lower()
    if raw_role in ["public", "user", "citizen", "resident"]:
        profile["role"] = "public"
    elif raw_role in ["admin", "superadmin", "administrator"]:
        profile["role"] = "admin"
    else:
        profile["role"] = "public"

    return profile


async def require_admin(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    FastAPI dependency that enforces RBAC based on the user's role from public.profiles:
    a. If role == 'admin': Grant access to all endpoints, including all /api/admin/* routes.
    b. If role == 'public': Raise HTTP 403 Forbidden ("Access denied. Admin privileges required.").
    """
    role = current_user.get("role", "public")
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Admin privileges required.",
        )
    return current_user
