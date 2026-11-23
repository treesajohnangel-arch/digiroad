import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiJ9.e30.x")

from app.api.routers.complaints import auto_priority


class TestAutoPriority(unittest.TestCase):
    def test_bands(self):
        self.assertEqual(auto_priority("High", "Pothole", 35.0), "P1")      # 3 + 2 + 1
        self.assertEqual(auto_priority("Critical", "Cracking", 90.0), "P2")  # 4
        self.assertEqual(auto_priority("Medium", "Cracking", 55.0), "P3")    # 2 + 1
        self.assertEqual(auto_priority("Low", "Drainage", 85.0), "P4")       # 1

    def test_unknown_inputs_fall_back_to_medium_without_pci(self):
        self.assertEqual(auto_priority(None, None, None), "P4")              # 2
        self.assertEqual(auto_priority("weird", " pothole ", None), "P3")    # 2 + 1


if __name__ == "__main__":
    unittest.main()
