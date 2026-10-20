#!/usr/bin/env python3
"""
Interactive CLI Terminal Chat for DigiRoad AI PaveBot / Agent.

Supports multi-turn conversation history and connects to either:
  1. http://127.0.0.1:8000/api/chat        (PaveBot PMS with Supabase context)
  2. http://127.0.0.1:8000/api/agent/chat  (Agent with tool-calling capabilities)

Usage:
    python terminal_chat.py                 # Connects to /api/chat (Default)
    python terminal_chat.py --agent         # Connects to /api/agent/chat
    python terminal_chat.py --url <URL>     # Connects to custom URL
"""

import sys
import json
import argparse
import httpx
from typing import List, Dict, Any

DEFAULT_CHAT_URL = "http://127.0.0.1:8000/api/chat"
DEFAULT_AGENT_URL = "http://127.0.0.1:8000/api/agent/chat"


def print_banner(current_url: str):
    banner = f"""
======================================================================
         DIGIROAD AI - PAVEBOT INTERACTIVE TERMINAL
   Expert Pavement Management & Deterioration Assistant (PCI/IRI)
======================================================================
Active Endpoint: {current_url}

Commands:
  /switch          : Toggle between /api/chat and /api/agent/chat
  /clear or /reset : Clear conversation history
  /exit or /quit   : Exit chat session
======================================================================
"""
    print(banner)


def send_chat_message(
    endpoint: str,
    message: str,
    history: List[Dict[str, str]]
) -> Dict[str, Any]:
    """Sends user query and chat history to the backend API."""
    payload = {
        "message": message,
        "history": history,
    }
    
    with httpx.Client(timeout=60.0) as client:
        response = client.post(endpoint, json=payload)
        response.raise_for_status()
        return response.json()


def main():
    parser = argparse.ArgumentParser(description="DigiRoad AI Interactive Terminal Chat")
    parser.add_argument("--agent", action="store_true", help="Connect to /api/agent/chat instead of /api/chat")
    parser.add_argument("--url", type=str, default=None, help="Custom API endpoint URL")
    args = parser.parse_args()

    if args.url:
        target_url = args.url
    elif args.agent:
        target_url = DEFAULT_AGENT_URL
    else:
        target_url = DEFAULT_CHAT_URL

    print_banner(target_url)

    history: List[Dict[str, str]] = []

    while True:
        try:
            user_input = input("You: ").strip()

            if not user_input:
                continue

            # Command: Exit
            if user_input.lower() in ["/exit", "/quit", "exit", "quit", "q"]:
                print("\nExiting PaveBot session. Goodbye!")
                break

            # Command: Clear history
            if user_input.lower() in ["/clear", "/reset"]:
                history.clear()
                print("\n[✓] Conversation history reset.\n")
                continue

            # Command: Switch endpoint
            if user_input.lower() in ["/switch"]:
                if target_url == DEFAULT_CHAT_URL:
                    target_url = DEFAULT_AGENT_URL
                else:
                    target_url = DEFAULT_CHAT_URL
                history.clear()
                print(f"\n[✓] Switched endpoint to: {target_url} (history reset)\n")
                continue

            # Send request to backend
            try:
                response_data = send_chat_message(target_url, user_input, history)

                reply = response_data.get("reply") or response_data.get("response") or "No reply received."
                tool_calls = response_data.get("tool_calls", [])

                # Update conversation history
                if "history" in response_data and isinstance(response_data["history"], list) and len(response_data["history"]) > 0:
                    history = response_data["history"]
                else:
                    history.append({"role": "user", "content": user_input})
                    history.append({"role": "assistant", "content": reply})

                # Display tool calls if any
                if tool_calls:
                    print(f"\n[🔧 Tool Calls]: {', '.join(tool_calls)}")

                # Print Assistant response
                print(f"\nPaveBot:\n{reply}\n")
                print("-" * 70)

            except httpx.ConnectError:
                print(f"\n[!] Connection Error: Cannot reach {target_url}.")
                print("    Make sure the FastAPI server is running (`python run.py`).\n")
            except httpx.HTTPStatusError as e:
                print(f"\n[!] HTTP Error {e.response.status_code}: {e.response.text}\n")
            except Exception as e:
                print(f"\n[!] Unexpected error: {e}\n")

        except (KeyboardInterrupt, EOFError):
            print("\n\nSession interrupted. Goodbye!")
            break


if __name__ == "__main__":
    main()
