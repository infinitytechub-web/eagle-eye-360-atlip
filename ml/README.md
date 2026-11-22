# ATLIP AI models — training, evaluation & export

The live app runs a **two-stage pipeline entirely in the browser** (onnxruntime-web, WebAssembly):

| Stage | Model | File | What it does |
|---|---|---|---|
| 1 | YOLO11n (default) / YOLO11s (high accuracy) | `public/models/atlip-detector-yolo11{n,s}.onnx` | Finds traffic-light housings (COCO class 9) |
| 2 | `atlip-state-v2` (77k-param CNN, 247 KB) | `public/models/atlip-state-v2.onnx` | Classifies each crop: RED / CAUTION / GREEN / UNKNOWN |

Then the app picks the largest (nearest) confident signal, requires **state confidence ≥ 0.7** and **3 consecutive agreeing frames**,
and otherwise reports **UNKNOWN**. Horizontal housings are rotated before classification. Operating point and measured metrics
live in `public/models/manifest.json` and are shown on the AI Engine page.

## Measured performance (22 Nov 2026)

**State classifier v2**
- Held-out test (447 crops: 297 real + 150 synthetic unknown): **97.1 % accuracy**; at conf 0.7, 95.6 % of real lights classified, 4 wrong colour claims.
- Cross-dataset, 2,494 real crops from German cities (DriveU, never trained on): at conf 0.7, **98.7 % of colour claims correct**, 56 % coverage (the rest → UNKNOWN), 2 red↔green swaps.

**Detector** (DriveU test split, 129 real driving frames; lights ≥ 25 px tall)
- YOLO11n: recall 50.8 %, precision ≥ 59 % at conf 0.25 — ~84 ms/frame single-thread CPU (~350 ms in browser WASM).
- YOLO11s: recall 62.9 %, precision ≥ 54 % — ~250 ms/frame CPU.
- Precision is a lower bound: that dataset labels only ego-relevant lights, so many "false positives" are real unlabelled lights.

## What is NOT done yet
- **No Ghanaian data** has been used for training or validation. Fine-tune before operational reliance.
- Arrow direction and pedestrian aspects are not separately recognised (classified by colour only).
- Distant signals (< 25 px) are frequently missed → UNKNOWN.

## Fine-tuning for Ghana (recommended next step)

1. Record dashcam / phone footage at the monitored intersections (day, night, rain, Harmattan haze). Extract ~1 frame/second.
2. Label with CVAT or Label Studio:
   - **Detector:** a box around every signal housing → export YOLO format → `dataset/images|labels/{train,val,test}`. ~1,500–3,000 frames is a good start.
   - **State:** crop each housing and sort into `crops/training/{red,yellow,green,unknown}` and `crops/test/...`.
3. Train:
   ```bash
   pip install -r ml/requirements.txt
   python ml/train_state_classifier.py --data crops --bg background_frames --out public/models/atlip-state-v3.onnx
   python ml/train_detector.py --data dataset --model yolo11n.pt --epochs 80 --name ghana-v1   # GPU recommended
   ```
4. Evaluate on your held-out Ghana test split (`ml/eval_detector.py`, `ml/eval_state_crossdataset.py`), update
   `public/models/manifest.json`, register the version in **AI Engine & Model Registry**, then deploy.

Never train on footage you are not authorised to use, and blur faces / number plates in any data you keep (Data Protection Act, 2012 (Act 843)).

## Licences
- Ultralytics YOLO11 weights and fine-tunes: **AGPL-3.0**. Serving them in a web app obliges you to offer the app's source to its users,
  or to obtain an Ultralytics Enterprise licence.
- `atlip-state-*` weights: trained here on the MIT-licensed Udacity traffic-light crops; © Infinity Techub Intelligence.
- DriveU (DTLD) data was used **for evaluation only** and is not redistributed.
