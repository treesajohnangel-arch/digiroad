import os
import sys
import unittest
from fastapi.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app
from app.database import supabase


class TestAuthAndRBAC(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.test_email = "authtest_engineer_01@digiroad.gov"
        cls.test_password = "SecureTestPassword123!"
        cls.test_name = "Chief Engineer Test"
        cls.created_user_id = None

        # Clean up any preexisting user with test_email
        if supabase:
            try:
                res = supabase.table("profiles").select("id").eq("email", cls.test_email).execute()
                for row in res.data or []:
                    supabase.table("profiles").delete().eq("id", row["id"]).execute()
                    supabase.auth.admin.delete_user(row["id"])
            except Exception:
                pass

    @classmethod
    def tearDownClass(cls):
        # Final cleanup
        if supabase and cls.created_user_id:
            try:
                supabase.table("profiles").delete().eq("id", cls.created_user_id).execute()
                supabase.auth.admin.delete_user(cls.created_user_id)
            except Exception:
                pass

    def test_01_signup_new_user_success(self):
        """Test signing up a new user creates account, profile, and returns session JWT."""
        payload = {
            "email": self.test_email,
            "password": self.test_password,
            "full_name": self.test_name,
        }
        response = self.client.post("/api/auth/signup", json=payload)
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertIn("access_token", data)
        self.assertIsNotNone(data["access_token"])
        self.assertEqual(data["role"], "public")
        self.assertIn("user", data)
        self.assertEqual(data["user"]["email"], self.test_email)
        self.assertEqual(data["user"]["full_name"], self.test_name)
        self.__class__.created_user_id = data["user"]["id"]
        self.__class__.user_jwt = data["access_token"]

    def test_02_signup_duplicate_email_returns_400(self):
        """Test signing up with an already existing email returns HTTP 400 with exact message."""
        payload = {
            "email": self.test_email,
            "password": "AnotherPassword456!",
            "full_name": "Duplicate Tester",
        }
        response = self.client.post("/api/auth/signup", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json().get("detail"),
            "An account with this email ID already exists. Please login instead.",
        )

    def test_03_login_valid_credentials(self):
        """Test login with valid email and password returns JWT and role."""
        payload = {
            "email": self.test_email,
            "password": self.test_password,
        }
        response = self.client.post("/api/auth/login", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("access_token", data)
        self.assertEqual(data["role"], "public")
        self.assertEqual(data["user"]["email"], self.test_email)

    def test_04_login_invalid_password_returns_401(self):
        """Test login with incorrect password returns 401."""
        payload = {
            "email": self.test_email,
            "password": "WrongPassword999!",
        }
        response = self.client.post("/api/auth/login", json=payload)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Invalid", response.json().get("detail", ""))

    def test_05_me_endpoint_with_valid_token(self):
        """Test /api/auth/me returns current user profile for valid Bearer token."""
        headers = {"Authorization": f"Bearer {self.user_jwt}"}
        response = self.client.get("/api/auth/me", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], self.created_user_id)
        self.assertEqual(data["email"], self.test_email)
        self.assertEqual(data["role"], "public")

    def test_06_me_endpoint_unauthorized_without_token(self):
        """Test /api/auth/me rejects unauthenticated requests."""
        response = self.client.get("/api/auth/me")
        self.assertEqual(response.status_code, 401)

    def test_07_public_user_forbidden_from_admin_route(self):
        """Test users with 'public' role receive 403 Forbidden on /api/admin/* endpoints."""
        headers = {"Authorization": f"Bearer {self.user_jwt}"}
        payload = {
            "complaint_id": "CMP-9999",
            "segment_id": "SEG-101",
            "notes": "Testing unauthorized repair attempt",
        }
        response = self.client.post("/api/admin/repair-finished", headers=headers, json=payload)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json().get("detail"),
            "Access denied. Admin privileges required.",
        )

    def test_08_admin_user_granted_access_to_admin_route(self):
        """Test upgrading role to 'admin' grants access to /api/admin/* endpoints."""
        if supabase and self.created_user_id:
            # Manually assign role 'admin' in public.profiles table as specified in requirement 3
            supabase.table("profiles").update({"role": "admin"}).eq("id", self.created_user_id).execute()

        # Check /api/auth/me now reflects admin role
        headers = {"Authorization": f"Bearer {self.user_jwt}"}
        me_res = self.client.get("/api/auth/me", headers=headers)
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json().get("role"), "admin")

        # Now test admin route /api/admin/repair-finished
        payload = {
            "complaint_id": "CMP-9999",
            "segment_id": "MDR47-S01",
            "notes": "Admin test repair",
        }
        response = self.client.post("/api/admin/repair-finished", headers=headers, json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertIn("marked as REPAIRED", response.json().get("message", ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)
