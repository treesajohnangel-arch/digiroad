# RoadWise AI: model card (road damage detector)

**Model in service:** Candidate 2, a fine-tuned YOLOv8n (Ultralytics), used by the background GeoAI worker.
**Status:** advisory decision support only. A human officer makes every final decision about damage category, severity and action.

Sources: `STAGE13_PHASE3_DATASET_AUDIT.md`, `STAGE13_PHASE4_MODEL_COMPARISON.md`, `STAGE13_PHASE4_FINAL_TEST_EVALUATION.md`, `geoai_adapter.py`. No retraining or re-evaluation was done in Stage 14.

---

## 1. Identity

| Item | Value |
|---|---|
| Architecture | YOLOv8n (nano) object detector, 640 px input |
| Starting weights | COCO-pretrained `yolov8n.pt` |
| Training | 40 epochs, batch 8, AdamW, close-mosaic for the last 10 epochs (`STAGE13_PHASE4_TRAINING_CONFIG.yaml`) |
| Checkpoint | `RoadWiseAI/models/stage13/yolov8n_experiment_01/weights/best.pt` |
| SHA-256 | `d078b1598fc5ed69de9650378807b1c68458c26a86959bc6fcc0b79c04cb5541` (checked by the worker at start-up; re-verified on 9 Nov 2026) |
| Registry key | `candidate_yolov8n_ft` (`GEOAI_MODEL_CANDIDATE`) |
| Classes | 0 Pothole, 1 Longitudinal crack, 2 Transverse crack, 3 Alligator crack, 4 Surface deterioration |

**Second model in the product.** The quick preview shown to a reporter while uploading a photo (`/api/detect`, `detector.py`) uses the older baseline checkpoint `RoadWiseAI/models/road_damage_yolov8n.pt` (SHA-256 `abc32d6d…0364`, Candidate 1). That baseline was trained on a random frame split that leaked near-duplicate frames between training and validation, so its higher validation score is not comparable. Only the worker's Candidate 2 predictions are stored and shown to officers. The two models can disagree: in the F5 acceptance run, the preview labelled a stock pothole photo "Surface deterioration 82%", while Candidate 2 found no damage in it.

## 2. Dataset

- **Source:** RDD2022, India subset. 7,706 annotated dashcam images (720×720): 3,785 with damage and 3,921 background; 8,203 boxes after reconciling RDD2022 sub-categories into the five RoadWise classes.
- **Leakage-safe split** (seed 42). Images were grouped into **85 continuous sequence clusters** (dashcam frames from the same road corridor), and whole clusters were assigned to one partition. This prevents near-identical consecutive frames from appearing in both training and test.

| Partition | Clusters | Images | Damaged | Background | Boxes |
|---|---:|---:|---:|---:|---:|
| Train | 63 | 5,407 | 2,626 | 2,781 | 5,700 |
| Validation | 14 | 1,137 | 555 | 582 | 1,235 |
| Test (quarantined) | 8 | 1,162 | 604 | 558 | 1,268 |

- **Training subset:** training used 3,939 images (all damaged images plus half of the background images) to limit background dilution.
- **Test set handling:** the test partition was evaluated once, in Stage 13. It was not re-used in Stage 14.

## 3. Performance (Stage 13 measurements)

| Metric | Validation | **Test (1,162 images)** |
|---|---:|---:|
| Precision | 35.33% | **36.91%** |
| Recall | 39.17% | **37.75%** |
| F1 | 37.15% | **37.32%** |
| mAP@50 | 32.56% | **34.17%** |
| mAP@50-95 | 13.66% | **15.00%** |

**Per class (test):**

| Class | GT boxes | Precision | Recall | mAP@50 | mAP@50-95 |
|---|---:|---:|---:|---:|---:|
| Pothole | 476 | 44.69% | 39.29% | 37.85% | 15.49% |
| Longitudinal crack | 258 | 36.48% | 27.52% | 26.60% | 10.89% |
| **Transverse crack** | **17** | **9.40%** | **4.98%** | **5.45%** | 1.56% |
| Alligator crack | 324 | 53.11% | 62.56% | 59.52% | 26.82% |
| Surface deterioration | 193 | 40.87% | 54.40% | 41.42% | 20.23% |

**Weak classes:**
- **Transverse crack is effectively not detected.** On the test set: 1 true positive, 16 misses, and 10 false positives (shadows and tar patches). With only 17 test boxes, a single detection moves recall by about 5.9 points, so the figure is also highly uncertain.
- **Longitudinal cracks:** about 72% are missed.
- **Potholes:** about 61% are missed, mostly shallow, small or distant ones.

## 4. Intended use

- Suggest a damage category, with boxes, for a photo submitted to the RoadWise pilot, so an officer can review it faster.
- Help prioritise an officer's review queue.

## 5. Out of scope

- Any automatic decision: severity, repair, spending, work-order approval or rejecting a citizen report.
- Measuring damage size, depth or structural condition.
- Use on imagery unlike the training data (night, heavy rain, drone or top-down views, non-Indian road types) without new evaluation.
- Any claim of real-world field accuracy. The metrics above are on a held-out part of RDD2022 India, not on Thiruvananthapuram pilot photos.

## 6. Responsible interpretation

- **Confidence is not correctness, and not severity.** A 90% box can be wrong; a missing box does not mean the road is undamaged.
- **The severity estimate is a heuristic** from box size and class. It is shown as "AI severity estimate (advisory)" and is never pre-filled into any severity field. Reporters and officers must choose severity themselves.
- **The human decision is authoritative and audited.** Officer confirm, correct and reject actions are stored in `damage_ai_verifications`, with reviewer, time, notes and the AI's original output, which is never overwritten.
- **A failed inference is shown as failed**, never as "no damage", and does not block manual review.
- **Field accuracy is unknown.** Collect officer verdicts during the pilot (verified, corrected, rejected) before making any statement about it.

## 7. Known limitations

- Severe class imbalance; transverse cracks are too rare to learn.
- Single-pass, unaugmented inference (no tiling or test-time augmentation).
- The reporter preview and the stored prediction come from different checkpoints (section 1).
- If a job is re-processed (re-delivery or lease recovery), the stored prediction row is updated in place, so there is still one row per report and model. The officer's verification record keeps the original class and severity, but the prediction row itself would show the re-run output.
