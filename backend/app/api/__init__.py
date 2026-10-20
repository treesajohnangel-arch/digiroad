from .auth import router as auth_router
from .home import router as home_router
from .complaints import router as complaints_router
from .admin import router as admin_router
from .simulations import router as simulations_router
from .trends import router as trends_router
from .agent import router as agent_router

__all__ = [
    "auth_router",
    "home_router",
    "complaints_router",
    "admin_router",
    "simulations_router",
    "trends_router",
    "agent_router",
]
