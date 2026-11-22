"""
Eagle Eye 360 · ATLIP — signal-state classifier (stage 2 of the detection pipeline).

Input : a traffic-light crop produced by the stage-1 YOLO detector, resized to 32x64 (W x H), RGB.
Output: RED | CAUTION | GREEN | UNKNOWN.

UNKNOWN is built from real crops with the illuminated lamp suppressed ("off"), glare / over-exposure,
heavy blur, and background patches that are not traffic lights. This teaches the model to refuse
rather than guess — the platform's safety rule.

Usage:
  python ml/train_state_classifier.py --data path/to/traffic_light_images --bg path/to/background_images \
      --out public/models/atlip-state-v1.onnx
Data layout (ImageFolder style): <data>/training/{red,yellow,green}/*.jpg and <data>/test/{red,yellow,green}/*.jpg
To fine-tune for Ghana, add Ghanaian crops to those folders (and an optional unknown/ folder) and re-run.
"""
import argparse, glob, json, os, random
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image, ImageEnhance, ImageFilter

CLASSES = ['RED', 'CAUTION', 'GREEN', 'UNKNOWN']
FOLDER = {'red': 0, 'yellow': 1, 'green': 2, 'unknown': 3}
W, H = 32, 64
SEED = 42


def set_seed(s=SEED):
    random.seed(s); np.random.seed(s); torch.manual_seed(s)


def load_split(root, split):
    items = []
    for name, idx in FOLDER.items():
        for f in sorted(glob.glob(os.path.join(root, split, name, '*'))):
            items.append((Image.open(f).convert('RGB'), idx))
    return items


def suppress_lamp(img):
    """Make an 'off' light: pull bright, saturated pixels down to the housing's dark grey."""
    a = np.asarray(img).astype(np.float32)
    mx, mn = a.max(2), a.min(2)
    mask = (mx > 120) & ((mx - mn) > 40)
    a[mask] = a[mask] * 0.18 + 25
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def make_unknown(lights, backgrounds, n):
    out = []
    for i in range(n):
        kind = i % 4
        if kind == 0:  # lamp off / unlit
            out.append(suppress_lamp(random.choice(lights)))
        elif kind == 1:  # glare / over-exposure washes out colour
            im = random.choice(lights)
            im = ImageEnhance.Brightness(im).enhance(random.uniform(2.6, 4.0))
            out.append(ImageEnhance.Color(im).enhance(random.uniform(0.0, 0.25)))
        elif kind == 2:  # severe blur / fog
            im = random.choice(lights).filter(ImageFilter.GaussianBlur(random.uniform(4, 8)))
            out.append(ImageEnhance.Contrast(im).enhance(random.uniform(0.2, 0.5)))
        else:  # background patch (no traffic light)
            bg = random.choice(backgrounds)
            w = random.randint(16, max(17, bg.width // 4)); h = min(bg.height, int(w * random.uniform(1.4, 2.6)))
            x = random.randint(0, bg.width - w); y = random.randint(0, max(0, bg.height - h))
            out.append(bg.crop((x, y, x + w, y + h)))
    return out


def bloom(img):
    """Camera over-exposure of the lit lamp: its core goes white while the halo keeps the colour."""
    a = np.asarray(img).astype(np.float32)
    mx, mn = a.max(2), a.min(2)
    lit = (mx > 110) & ((mx - mn) > 35)
    if lit.sum() < 3: return img
    k = random.uniform(0.45, 0.9)
    core = lit & (mx > np.percentile(mx[lit], random.uniform(30, 60)))
    a[core] = a[core] * (1 - k) + 255 * k
    return Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(random.uniform(0.4, 1.0)))


def augment(img):
    if random.random() < 0.35:
        img = bloom(img)
    if random.random() < 0.35:  # low-resolution capture (distant signal), then upsampled
        w = random.randint(7, 14); img = img.resize((w, max(10, int(w * img.height / img.width))), Image.BILINEAR)
    if random.random() < 0.25:  # aspect distortion (detector boxes, squashed crops)
        img = img.resize((int(img.width * random.uniform(1.0, 1.9)), img.height))
    if random.random() < 0.5:  # small crop jitter, as detector boxes are imprecise
        w, h = img.size; dx, dy = int(w * 0.12), int(h * 0.08)
        l, t = random.randint(0, dx), random.randint(0, dy)
        img = img.crop((l, t, w - random.randint(0, dx), h - random.randint(0, dy)))
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.6, 1.4))
    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.7, 1.3))
    img = ImageEnhance.Color(img).enhance(random.uniform(0.7, 1.3))
    if random.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.2)))
    return img


def to_tensor(img):
    a = np.asarray(img.resize((W, H), Image.BILINEAR)).astype(np.float32) / 255.0
    return torch.from_numpy(a.transpose(2, 0, 1))


class StateNet(nn.Module):
    """~60k-parameter CNN; runs in well under 1 ms per crop in the browser."""
    def __init__(self, n=len(CLASSES)):
        super().__init__()
        def block(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))
        self.f = nn.Sequential(block(3, 16), nn.MaxPool2d(2), block(16, 32), nn.MaxPool2d(2),
                               block(32, 64), nn.MaxPool2d(2), block(64, 64))
        self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(64 * 2, n))  # avg+max pooled features

    def forward(self, x):
        x = self.f(x)
        x = torch.cat([F.adaptive_avg_pool2d(x, 1).flatten(1), F.adaptive_max_pool2d(x, 1).flatten(1)], 1)
        return self.head(x)


def evaluate(model, items):
    model.eval(); conf = np.zeros((4, 4), int)
    with torch.no_grad():
        for i in range(0, len(items), 256):
            b = items[i:i + 256]
            x = torch.stack([to_tensor(im) for im, _ in b])
            p = model(x).argmax(1).numpy()
            for (_, y), q in zip(b, p): conf[y, q] += 1
    return conf


def report(conf):
    rows = {}
    for i, c in enumerate(CLASSES):
        tp = conf[i, i]; prec = tp / max(1, conf[:, i].sum()); rec = tp / max(1, conf[i].sum())
        rows[c] = {'precision': round(float(prec), 4), 'recall': round(float(rec), 4), 'support': int(conf[i].sum())}
    rows['accuracy'] = round(float(np.trace(conf) / max(1, conf.sum())), 4)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True); ap.add_argument('--bg', required=True)
    ap.add_argument('--out', default='public/models/atlip-state-v2.onnx')
    ap.add_argument('--epochs', type=int, default=60)
    a = ap.parse_args(); set_seed()

    train, test = load_split(a.data, 'training'), load_split(a.data, 'test')
    bgs = [Image.open(f).convert('RGB') for f in sorted(glob.glob(os.path.join(a.bg, '*.jpg')))]
    lights_tr = [im for im, y in train if y < 3]; lights_te = [im for im, y in test if y < 3]
    if not any(y == 3 for _, y in train): train += [(im, 3) for im in make_unknown(lights_tr, bgs[: len(bgs) * 3 // 4], 600)]
    if not any(y == 3 for _, y in test): test += [(im, 3) for im in make_unknown(lights_te, bgs[len(bgs) * 3 // 4:], 150)]

    # hold out 10% of training for model selection
    random.shuffle(train); nval = len(train) // 10; val, train = train[:nval], train[nval:]
    counts = np.bincount([y for _, y in train], minlength=4)
    print('train counts', dict(zip(CLASSES, counts.tolist())), 'val', len(val), 'test', len(test))
    # balanced sampling: rare classes (amber) are oversampled each epoch
    weights = np.array([1.0 / counts[y] for _, y in train]); weights /= weights.sum()

    model = StateNet(); opt = torch.optim.AdamW(model.parameters(), 3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=a.epochs * 20)
    best, best_state = -1, None
    for ep in range(a.epochs):
        model.train()
        for _ in range(20):
            idx = np.random.choice(len(train), 64, p=weights)
            x = torch.stack([to_tensor(augment(train[i][0])) for i in idx]); y = torch.tensor([train[i][1] for i in idx])
            loss = F.cross_entropy(model(x), y, label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        vc = evaluate(model, val); r = report(vc)
        macro = np.mean([r[c]['recall'] for c in CLASSES])
        if macro > best: best, best_state = macro, {k: v.clone() for k, v in model.state_dict().items()}
        if ep % 5 == 4: print(f'epoch {ep+1:02d} loss {loss.item():.3f} val acc {r["accuracy"]:.3f} macro-recall {macro:.3f}')

    model.load_state_dict(best_state); model.eval()
    conf = evaluate(model, test); rep = report(conf)
    print('TEST confusion (rows=true, cols=pred, order', CLASSES, ')\n', conf); print(json.dumps(rep, indent=1))

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    torch.onnx.export(model, torch.zeros(1, 3, H, W), a.out, input_names=['crop'], output_names=['logits'],
                      dynamic_axes={'crop': {0: 'n'}, 'logits': {0: 'n'}}, opset_version=17, dynamo=False)
    meta = {'model': 'atlip-state-v2', 'classes': CLASSES, 'input': {'width': W, 'height': H, 'layout': 'NCHW', 'range': '0-1 RGB'},
            'params': sum(p.numel() for p in model.parameters()), 'test_report': rep, 'test_confusion': conf.tolist(),
            'data': 'Udacity/MIT traffic-light crops (MIT licence) + synthetic UNKNOWN (unlit, glare, blur, background)'}
    json.dump(meta, open(a.out.replace('.onnx', '.json'), 'w'), indent=1)
    print('saved', a.out)


if __name__ == '__main__':
    main()
