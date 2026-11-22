"""
Eagle Eye 360 · ATLIP — fine-tune the stage-1 traffic-light detector on locally labelled footage.

Starts from Ultralytics YOLO11 COCO weights and trains a single class: traffic_light.
Label images in YOLO format (e.g. with CVAT or Label Studio, export "YOLO 1.1"), one box per signal housing:

  dataset/
    images/{train,val,test}/*.jpg
    labels/{train,val,test}/*.txt     # "0 cx cy w h" normalised, one line per housing

Usage (GPU strongly recommended; CPU works for small sets):
  python ml/train_detector.py --data dataset --model yolo11n.pt --epochs 80 --imgsz 640
Outputs: runs/atlip-detector/weights/best.pt and public/models/atlip-detector-<name>.onnx

After fine-tuning, the exported model has ONE class (index 0) — set TL_CLASS = 0 in src/ai/detector.worker.ts
and change the output parsing offset accordingly (4 + 0), then update public/models/manifest.json with the new
evaluation figures printed below.

Licence: Ultralytics YOLO is AGPL-3.0. Deploying fine-tuned weights in a network service obliges you to offer the
corresponding source to its users, or to obtain an Ultralytics Enterprise licence.
"""
import argparse, os, shutil, yaml
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='dataset root in YOLO layout')
    ap.add_argument('--model', default='yolo11n.pt')
    ap.add_argument('--epochs', type=int, default=80)
    ap.add_argument('--imgsz', type=int, default=640)
    ap.add_argument('--batch', type=int, default=16)
    ap.add_argument('--name', default='ghana-v1')
    a = ap.parse_args()

    cfg = {'path': os.path.abspath(a.data), 'train': 'images/train', 'val': 'images/val', 'test': 'images/test', 'names': {0: 'traffic_light'}}
    yml = os.path.join(a.data, 'atlip.yaml'); yaml.safe_dump(cfg, open(yml, 'w'))

    m = YOLO(a.model)
    m.train(data=yml, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, project='runs', name='atlip-detector', exist_ok=True,
            # traffic lights are small and colour matters: keep hue augmentation low, avoid flips that swap lamp order
            hsv_h=0.005, hsv_s=0.5, hsv_v=0.4, fliplr=0.0, flipud=0.0, mosaic=1.0, scale=0.5, patience=20, seed=42)

    best = YOLO('runs/atlip-detector/weights/best.pt')
    r = best.val(data=yml, split='test', imgsz=a.imgsz, plots=False)
    print(f'TEST precision {r.box.mp:.3f} recall {r.box.mr:.3f} mAP50 {r.box.map50:.3f} mAP50-95 {r.box.map:.3f}')

    onnx = best.export(format='onnx', imgsz=a.imgsz, opset=17, simplify=True)
    os.makedirs('public/models', exist_ok=True)
    dst = f'public/models/atlip-detector-{a.name}.onnx'; shutil.copy(onnx, dst); print('exported', dst)


if __name__ == '__main__':
    main()
