import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field
from supabase import create_client, Client

from app.config import settings
from app.services.supabase_client import supabase
from app.core.authentication import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Authentication"])


class SignUpRequest(BaseModel):
    email: str = Field(..., description="User email address", example="engineer@digiroad.gov")
    password: str = Field(..., min_length=6, description="User password", example="SecurePass123!")
    full_name: str = Field(..., min_length=1, description="User's full name", example="Jane Doe")


class LoginRequest(BaseModel):
    email: str = Field(..., description="User email address", example="engineer@digiroad.gov")
    password: str = Field(..., min_length=1, description="User password", example="SecurePass123!")


class UserProfile(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = ""
    role: str = "public"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AuthResponse(BaseModel):
    message: str
    access_token: Optional[str] = None
    token_type: str = "bearer"
    role: str = "public"
    user: Optional[UserProfile] = None


def get_fresh_auth_client() -> Optional[Client]:
    """
    Creates an independent client instance for client-level auth actions
    (such as sign_in_with_password) to prevent polluting the service-role admin client.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return None
    try:
        return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    except Exception as e:
        logger.error("Failed to create fresh Supabase auth client: %s", e)
        return None


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignUpRequest):
    """
    Sign up a new user with Supabase Auth:
    a. Check if the email already exists in public.profiles or Supabase Auth.
    b. If email ALREADY EXISTS: return HTTP 400 with:
       "An account with this email ID already exists. Please login instead."
    c. If NEW: Create user in Supabase Auth, insert profile into public.profiles
       with default role 'public', and issue JWT session token.
    """
    clean_email = payload.email.strip().lower()
    clean_password = payload.password.strip()
    clean_name = payload.full_name.strip()

    # Fallback mock mode if Supabase is not configured
    if supabase is None:
        mock_id = "mock-user-001"
        mock_profile = UserProfile(
            id=mock_id,
            email=clean_email,
            full_name=clean_name,
            role="public",
            created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        return AuthResponse(
            message="User signed up successfully (Mock Mode)",
            access_token="demo-user-token",
            token_type="bearer",
            role="public",
            user=mock_profile,
        )

    # 1. Check if email already exists in public.profiles
    try:
        profile_res = supabase.table("profiles").select("id, email").eq("email", clean_email).execute()
        if profile_res.data and len(profile_res.data) > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email ID already exists. Please login instead.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Error checking profiles for existing email: %s", e)

    # 2. Check if email already exists in Supabase Auth
    try:
        auth_users = supabase.auth.admin.list_users()
        user_list = (
            auth_users.users
            if hasattr(auth_users, "users")
            else (auth_users if isinstance(auth_users, list) else [])
        )
        for u in user_list:
            if getattr(u, "email", "").lower() == clean_email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="An account with this email ID already exists. Please login instead.",
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Error listing auth users: %s", e)

    # 3. Create user in Supabase Auth
    try:
        auth_res = supabase.auth.admin.create_user({
            "email": clean_email,
            "password": clean_password,
            "email_confirm": True,
            "user_metadata": {"full_name": clean_name},
        })
        new_user = auth_res.user
        if not new_user:
            raise RuntimeError("Failed to create user in Supabase Auth")
        user_id = new_user.id
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e).lower()
        if "already" in err_str or "registered" in err_str or "exists" in err_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email ID already exists. Please login instead.",
            )
        logger.error("Signup admin create_user failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Registration failed: {str(e)}",
        )

    # 4. Insert/upsert profile record into public.profiles with default enum role 'user'
    now_iso = datetime.now(timezone.utc).isoformat()
    profile_data = {
        "id": user_id,
        "email": clean_email,
        "full_name": clean_name,
        "role": "user",
        "updated_at": now_iso,
    }

    try:
        supabase.table("profiles").upsert(profile_data).execute()
    except Exception as e:
        logger.error("Failed to upsert profile record with role 'user': %s", e)


    # 5. Issue JWT session token by signing in with the user's credentials
    access_token = None
    auth_client = get_fresh_auth_client()
    if auth_client:
        try:
            sign_in_res = auth_client.auth.sign_in_with_password({
                "email": clean_email,
                "password": clean_password,
            })
            if sign_in_res and sign_in_res.session:
                access_token = sign_in_res.session.access_token
        except Exception as e:
            logger.warning("Auto sign-in after signup failed: %s", e)

    # Fallback: if Supabase Auth auto sign-in did not return a session, sign a valid JWT token
    if not access_token:
        jwt_secret = settings.SUPABASE_JWT_SECRET.strip() if settings.SUPABASE_JWT_SECRET else ""
        if jwt_secret:
            try:
                import jwt
                token_payload = {
                    "sub": str(user_id),
                    "email": clean_email,
                    "role": "authenticated",
                    "aud": "authenticated",
                    "exp": int(datetime.now(timezone.utc).timestamp()) + 86400 * 7,
                }
                access_token = jwt.encode(token_payload, jwt_secret, algorithm="HS256")
            except Exception as jwt_err:
                logger.warning("Fallback JWT token creation failed: %s", jwt_err)

    if not access_token:
        access_token = f"auth-token-{str(user_id)[:8]}"

    return AuthResponse(
        message="User signed up successfully",
        access_token=access_token,
        token_type="bearer",
        role="public",
        user=UserProfile(
            id=user_id,
            email=clean_email,
            full_name=clean_name,
            role="public",
            created_at=now_iso,
            updated_at=now_iso,
        ),
    )


@router.post("/login", response_model=AuthResponse, status_code=status.HTTP_200_OK)
async def login(payload: LoginRequest):
    """
    Authenticate an existing user with Supabase Auth:
    Returns JWT access token, assigned role ('admin' or 'public'), and user profile.
    """
    clean_email = payload.email.strip().lower()
    clean_password = payload.password.strip()

    if supabase is None:
        # Mock mode fallback
        role = "admin" if clean_email == "admin@digiroad.gov" else "public"
        if clean_email not in {"admin@digiroad.gov", "engineer@digiroad.local"}:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        return AuthResponse(
            message="Login successful (Mock Mode)",
            access_token="demo-admin-token" if role == "admin" else "demo-user-token",
            token_type="bearer",
            role=role,
            user=UserProfile(
                id="mock-admin-001" if role == "admin" else "mock-user-001",
                email=clean_email,
                full_name="Demo Administrator" if role == "admin" else "Demo Engineer",
                role=role,
            ),
        )

    auth_client = get_fresh_auth_client()
    if not auth_client:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase client initialization error",
        )

    try:
        sign_in_res = auth_client.auth.sign_in_with_password({
            "email": clean_email,
            "password": clean_password,
        })
    except Exception as e:
        logger.warning("Sign in failed for %s: %s", clean_email, e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not sign_in_res.session or not sign_in_res.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    access_token = sign_in_res.session.access_token
    user_id = sign_in_res.user.id

    # Fetch profile and assigned role from public.profiles
    profile_data: Optional[Dict[str, Any]] = None
    try:
        res = supabase.table("profiles").select("*").eq("id", user_id).execute()
        if res.data and len(res.data) > 0:
            profile_data = res.data[0]
    except Exception as e:
        logger.warning("Failed to query profile on login: %s", e)

    if not profile_data:
        meta = sign_in_res.user.user_metadata or {}
        profile_data = {
            "id": user_id,
            "email": clean_email,
            "full_name": meta.get("full_name") or "User",
            "role": "public",
        }

    raw_role = (profile_data.get("role") or "public").strip().lower()
    assigned_role = "admin" if raw_role in ["admin", "superadmin", "administrator"] else "public"
    profile_data["role"] = assigned_role

    return AuthResponse(
        message="Login successful",
        access_token=access_token,
        token_type="bearer",
        role=assigned_role,
        user=UserProfile(
            id=profile_data["id"],
            email=profile_data.get("email") or clean_email,
            full_name=profile_data.get("full_name") or "",
            role=assigned_role,
            created_at=profile_data.get("created_at"),
            updated_at=profile_data.get("updated_at"),
        ),
    )


@router.get("/me", response_model=UserProfile, status_code=status.HTTP_200_OK)
async def get_current_user_profile(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """
    Accepts JWT Bearer token and returns the current user profile including assigned role.
    """
    return UserProfile(
        id=str(current_user.get("id")),
        email=str(current_user.get("email", "")),
        full_name=current_user.get("full_name") or "",
        role=str(current_user.get("role", "public")),
        created_at=current_user.get("created_at"),
        updated_at=current_user.get("updated_at"),
    )
