"""Evaluate COCO-pretrained YOLO detectors on a YOLO-format traffic-light test split.
Usage: python ml/eval_detector.py <dataset_root> [weights...]  — counts lights >= 25 px tall (driving-relevant)."""
import glob, sys, numpy as np
from ultralytics import YOLO
from PIL import Image
root=sys.argv[1] if len(sys.argv) > 1 else 'dataset'
imgs=sorted(glob.glob(root+'/images/test/*'))
def iou(a,b):
    x1,y1=max(a[0],b[0]),max(a[1],b[1]); x2,y2=min(a[2],b[2]),min(a[3],b[3])
    i=max(0,x2-x1)*max(0,y2-y1); return i/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i+1e-9)
data=[]
for f in imgs:
    W,H=Image.open(f).size; gt=[]
    for l in open(f.replace('/images/','/labels/').rsplit('.',1)[0]+'.txt'):
        c,x,y,bw,bh=map(float,l.split()); gt.append([(x-bw/2)*W,(y-bh/2)*H,(x+bw/2)*W,(y+bh/2)*H])
    data.append((f,gt))
for w in (sys.argv[2:] or ['yolo11n.pt','yolo11s.pt']):
    m=YOLO(w); preds=[(m.predict(f,imgsz=640,classes=[9],conf=0.15,verbose=False)[0].boxes, gt) for f,gt in data]
    for th in [0.25,0.35,0.5]:
        tp=fp=fn=0
        for b,gt in preds:
            pr=[p for p,c in zip(b.xyxy.numpy().tolist(), b.conf.numpy().tolist()) if c>=th and p[3]-p[1]>=25]
            big=[g for g in gt if g[3]-g[1]>=25]; used=set()
            for g in big:
                j=max(range(len(pr)),key=lambda j:iou(g,pr[j]),default=None)
                if j is not None and iou(g,pr[j])>=0.3 and j not in used: tp+=1; used.add(j)
                else: fn+=1
            # predictions that match ANY gt (incl. small) are not false positives
            for j,p in enumerate(pr):
                if j in used: continue
                if any(iou(g,p)>=0.3 for g in gt): continue
                fp+=1
        print(f'{w} conf>={th}: lights>=25px recall {tp/(tp+fn):.3f}  precision {tp/max(1,tp+fp):.3f}  (tp {tp} fp {fp} fn {fn})')
