from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings

# Import API routers
from app.api.routers.auth import router as auth_router
from app.api.home import router as home_router
from app.api.routers import complaints
from app.api.admin import router as admin_router
from app.api.simulations import router as simulations_router
from app.api.routers import trends
from app.api.agent import router as agent_router
from app.api.routers import chat
from app.core.authentication import require_admin
from app.scheduler import start_scheduler, shutdown_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the weekly simulation scheduler with the app, and stop it on shutdown."""
    start_scheduler()
    try:
        yield
    finally:
        shutdown_scheduler()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="FastAPI Backend for DigiRoad AI - Smart Pavement Inspection, Deterioration Modeling & Complaint Management",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure CORS Middleware
allowed_origins = [
    "https://digiroad-frontend.onrender.com",
    "https://digiroad-1.onrender.com",
    "https://digiroad-2.onrender.com",
    "https://digiroad-production.up.railway.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers with designated prefixes
app.include_router(auth_router, prefix="/api/auth")
app.include_router(home_router, prefix="/api/home")
app.include_router(complaints.router)
app.include_router(admin_router, prefix="/api/admin", dependencies=[Depends(require_admin)])
app.include_router(simulations_router, prefix="/api/simulations")
app.include_router(trends.router)
app.include_router(agent_router, prefix="/api/agent")
app.include_router(chat.router)


@app.get("/", tags=["Health Check"])
async def root():
    """Root status endpoint returning service info and OpenAPI link."""
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": "/docs",
    }


@app.get("/health", tags=["Health Check"])
async def health_check():
    """Health check endpoint for container probes."""
    return {"status": "healthy"}
