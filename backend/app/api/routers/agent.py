"""
Router for AI Agent. Re-exports the router and schemas from app.api.agent.
"""
from app.api.agent import router, chat_with_agent, ChatMessageInput, ChatMessageResponse

__all__ = ["router", "chat_with_agent", "ChatMessageInput", "ChatMessageResponse"]
