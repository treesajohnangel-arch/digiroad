import base64
import os
import sys
import unittest

from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiJ9.e30.x")

from app.api.routers.complaints import _decode_photo


class TestComplaintPhoto(unittest.TestCase):
    def test_accepts_jpeg_png_and_data_url(self):
        jpg = b"\xff\xd8\xff\xe0" + b"0" * 100
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 10
        self.assertEqual(_decode_photo(base64.b64encode(jpg).decode()), (jpg, "jpg"))
        self.assertEqual(_decode_photo("data:image/png;base64," + base64.b64encode(png).decode())[1], "png")

    def test_rejects_bad_input(self):
        too_big = b"\xff\xd8\xff" + b"0" * 1_000_000
        for raw in ["!!not base64", base64.b64encode(b"GIF89a....").decode(), base64.b64encode(too_big).decode()]:
            with self.assertRaises(HTTPException) as ctx:
                _decode_photo(raw)
            self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
