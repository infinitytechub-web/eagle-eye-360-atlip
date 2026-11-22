"""Cross-dataset check of the state classifier on crops labelled {"state": 0..4} (off, red, red-yellow, yellow, green).
Usage: python ml/eval_state_crossdataset.py <model.onnx> <crops_dir>"""
import sys, glob, json, numpy as np, onnxruntime as ort
sys.path.insert(0, 'ml'); import train_state_classifier as T
from PIL import Image
MAP = {0: 3, 1: 0, 2: 1, 3: 1, 4: 2}  # off->UNKNOWN, red->RED, red-yellow->CAUTION, yellow->CAUTION, green->GREEN
fs = sorted(glob.glob((sys.argv[2] if len(sys.argv) > 2 else 'crops') + '/*.jpg'))
y = np.array([MAP[json.load(open(f[:-4] + '.json'))['state']] for f in fs])
x = np.stack([T.to_tensor(Image.open(f).convert('RGB')).numpy() for f in fs])
s = ort.InferenceSession(sys.argv[1] if len(sys.argv) > 1 else 'public/models/atlip-state-v1.onnx')
lg = s.run(None, {'crop': x})[0]; p = np.exp(lg - lg.max(1, keepdims=True)); p /= p.sum(1, keepdims=True)
print('n =', len(y), 'true dist', np.bincount(y, minlength=4).tolist(), '(RED, CAUTION, GREEN, UNKNOWN)')
for th in [0.5, 0.6, 0.7, 0.8]:
    pred = p.argmax(1).copy(); pred[p.max(1) < th] = 3
    c = np.zeros((4, 4), int)
    for a, b in zip(y, pred): c[a, b] += 1
    lights = y < 3; claimed = pred < 3
    correct_claims = ((pred == y) & claimed).sum()
    print(f'th={th}: coverage(lights given a colour)={(claimed & lights).sum()/lights.sum():.3f}  '
          f'precision of colour claims={correct_claims/max(1,claimed.sum()):.3f}  red<->green swaps={c[0,2]+c[2,0]}')
    print(c)
