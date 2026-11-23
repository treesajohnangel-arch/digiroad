"""
RoadWise AI road-damage detector (YOLOv8n, RDD2022 India) - standalone ONNX inference.

No PyTorch / ultralytics needed: only onnxruntime, numpy, Pillow, opencv-python-headless.
Pre/post-processing matches ultralytics YOLOv8 (letterbox, class-aware NMS), so results
match `YOLO("road_damage_yolov8n.pt").predict(...)`.

Usage:
    from roadwise_detector import RoadDamageDetector
    det = RoadDamageDetector()                      # loads weights/road_damage_yolov8n.onnx
    det.detect("photo.jpg")                         # -> list of dicts
"""
import ast
import hashlib
import os

import cv2
import numpy as np
from PIL import Image, ImageOps

STRIDE = 32
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ONNX = os.path.join(HERE, "weights", "road_damage_yolov8n.onnx")
CLASS_NAMES = {
    0: "Pothole",
    1: "Longitudinal crack",
    2: "Transverse crack",
    3: "Alligator crack",
    4: "Surface deterioration",
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def letterbox(img: Image.Image, imgsz: int):
    """Resize keeping aspect ratio, pad to a multiple of 32 with grey 114 (ultralytics auto=True)."""
    w, h = img.size
    r = min(imgsz / h, imgsz / w)
    nw, nh = int(round(w * r)), int(round(h * r))
    pw, ph = (-nw) % STRIDE, (-nh) % STRIDE
    left, top = pw // 2, ph // 2
    canvas = np.full((nh + ph, nw + pw, 3), 114, dtype=np.uint8)
    # cv2 INTER_LINEAR matches ultralytics; PIL BILINEAR antialiases and shifts scores
    canvas[top:top + nh, left:left + nw] = cv2.resize(np.asarray(img), (nw, nh), interpolation=cv2.INTER_LINEAR)
    x = canvas.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    return np.ascontiguousarray(x), r, left, top


def nms(boxes, scores, iou):
    """Greedy NMS on xyxy boxes; returns kept indices, highest score first."""
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(i)
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        order = rest[inter / (area_i + area_r - inter + 1e-9) <= iou]
    return keep


class RoadDamageDetector:
    def __init__(self, onnx_path=DEFAULT_ONNX, expected_sha256=None, threads=1):
        import onnxruntime as ort
        if expected_sha256 and sha256_file(onnx_path).lower() != expected_sha256.lower():
            raise ValueError(f"ONNX model SHA256 mismatch: {onnx_path}")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads   # small hosts (Render free): extra threads only add memory
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(onnx_path, sess_options=opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        meta = self.session.get_modelmeta().custom_metadata_map
        names = ast.literal_eval(meta["names"]) if "names" in meta else CLASS_NAMES
        self.names = {int(k): v for k, v in names.items()}

    def detect(self, image, conf=0.25, iou=0.7, imgsz=640, max_det=300):
        """image: file path, bytes-like file object, PIL Image or RGB numpy array.
        Returns [{"class_id", "label", "confidence", "box": [x1, y1, x2, y2]}] in original pixels,
        sorted by confidence (highest first)."""
        if isinstance(image, Image.Image):
            img = image
        elif isinstance(image, np.ndarray):
            img = Image.fromarray(image)
        else:
            img = ImageOps.exif_transpose(Image.open(image))   # phone photos: honour EXIF rotation
        img = img.convert("RGB")

        x, r, left, top = letterbox(img, int(imgsz))
        out = self.session.run(None, {self.input_name: x})[0][0].T   # (N, 4 + classes)
        scores_all = out[:, 4:]
        cls = scores_all.argmax(1)
        scores = scores_all[np.arange(len(cls)), cls]
        m = scores >= conf
        out, cls, scores = out[m], cls[m], scores[m]
        if not len(scores):
            return []

        cx, cy, bw, bh = out[:, 0], out[:, 1], out[:, 2], out[:, 3]
        xyxy = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], 1)
        keep = nms(xyxy + cls[:, None] * 7680.0, scores, iou)[:max_det]   # class-aware NMS via offset
        w, h = img.size
        results = []
        for i in keep:
            b = np.clip((xyxy[i] - [left, top, left, top]) / r, 0, [w, h, w, h])
            results.append({
                "class_id": int(cls[i]),
                "label": self.names.get(int(cls[i]), str(cls[i])),
                "confidence": round(float(scores[i]), 4),
                "box": [round(float(v), 1) for v in b],
            })
        return results


if __name__ == "__main__":
    import json
    import sys
    if len(sys.argv) < 2:
        sys.exit("usage: python roadwise_detector.py <image> [conf]")
    det = RoadDamageDetector()
    print(json.dumps(det.detect(sys.argv[1], conf=float(sys.argv[2]) if len(sys.argv) > 2 else 0.25), indent=2))
