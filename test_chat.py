#!/usr/bin/env python3
"""
Verification test script for DigiRoad AI PaveBot chat endpoint.
Sends a POST request to http://127.0.0.1:8000/api/chat with a sample payload
and prints the status code and response payload.
"""

import os
import sys
import json
from pathlib import Path
import httpx

API_URL = "http://127.0.0.1:8000/api/chat"

SAMPLE_PAYLOAD = {
    "message": "What is PCI and what happens if Segment 101 drops below 40?",
    "history": [],
}


def run_verification():
    print("=" * 70)
    print("DigiRoad AI Chatbot Verification Test")
    print(f"Target URL: {API_URL}")
    print(f"Request Payload:\n{json.dumps(SAMPLE_PAYLOAD, indent=2)}")
    print("=" * 70)

    try:
        print(f"\nSending POST request to {API_URL}...")
        response = httpx.post(API_URL, json=SAMPLE_PAYLOAD, timeout=60.0)

        print(f"\nHTTP Status Code: {response.status_code}")
        try:
            res_data = response.json()
            print("\nResponse Payload:")
            print(json.dumps(res_data, indent=2))
        except Exception:
            print(f"\nRaw Response Body:\n{response.text}")

        if response.status_code == 200:
            print("\n>>> Verification Test PASSED! Chatbot responded successfully.")
        else:
            print(f"\n>>> Verification returned HTTP {response.status_code}.")

    except httpx.ConnectError:
        print(f"\n[INFO] Live server is not currently reachable at {API_URL}.")
        print("[INFO] Executing in-process verification test against FastAPI app...")

        # Ensure backend directory is in sys.path
        current_dir = Path(__file__).resolve().parent
        if (current_dir / "backend").exists():
            sys.path.insert(0, str(current_dir / "backend"))
        else:
            sys.path.insert(0, str(current_dir))

        from app.main import app
        from fastapi.testclient import TestClient

        client = TestClient(app)
        response = client.post("/api/chat", json=SAMPLE_PAYLOAD)

        print(f"\nHTTP Status Code: {response.status_code}")
        try:
            res_data = response.json()
            print("\nResponse Payload:")
            print(json.dumps(res_data, indent=2))
        except Exception:
            print(f"\nRaw Response Body:\n{response.text}")

        if response.status_code == 200:
            print("\n>>> In-Process Verification Test PASSED! Chatbot responded successfully.")
        else:
            print(f"\n>>> Verification returned HTTP {response.status_code}.")


if __name__ == "__main__":
    run_verification()
