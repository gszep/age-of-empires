"""Display/sRGB HUD stroke measurements for #92's supplied native capture.

No owned image is tracked. Masks use a fixed luminance threshold; crops avoid
panel borders/icons. Normalize to a 64px bright-glyph height with nearest
sampling (no extra antialiasing), then measure occupied fraction, bright-core
luminance, and the 1-native-pixel ring outside bright strokes. These are stroke
statistics, not a claim of identical glyph geometry or background art.
"""
import argparse
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

LABELS = ["5000", "4700", "4800", "0", "4/20", "Imperial Age"]
NATIVE_BOXES = [(71, 30, 113, 49), (203, 30, 246, 49), (337, 30, 382, 49),
                (471, 30, 486, 49), (605, 30, 650, 49), (889, 26, 1034, 56)]
RING_RADIUS = 1
MAX_STROKE_CHROMA = 10
LUMA = np.array([.2126, .7152, .0722])
# Chosen before the screenshot sweep; do not widen to accommodate a regression.
TOLERANCES = {"brightFraction": .05, "coreLuma": 10, "ringLuma": 25}


def require_expected_labels(rows):
    if not isinstance(rows, list) or len(rows) != len(LABELS):
        raise ValueError(f"expected exactly {len(LABELS)} labels: {LABELS}")
    if any(not isinstance(row, dict) for row in rows) or [row.get("text") for row in rows] != LABELS:
        raise ValueError(f"expected these six labels in order, without missing/empty/duplicate entries: {LABELS}")


def measure(image, tint=(255, 255, 255)):
    rgb = np.asarray(image.convert("RGB"))
    luminance = rgb @ LUMA
    # Background stone is beige, whereas the captured text is neutral white.
    # The former spread<=30 admitted bright beige trim below descenders when
    # the crop was expanded. The native glyph cores are achromatic; <=10 keeps
    # their antialiasing without counting that trim as part of the text.
    # For the explicitly labelled OLD baseline only, white-balance its known
    # CSS tint before segmenting; reported core luminance remains uncorrected.
    balanced = rgb.astype(float) * (255 / np.array(tint))
    bright = (balanced @ LUMA >= 180) & (balanced.max(2)-balanced.min(2) <= MAX_STROKE_CHROMA)
    rows, cols = np.where(bright)
    if not len(rows):
        raise ValueError("no bright glyph pixels")
    box = (int(cols.min()), int(rows.min()), int(cols.max()+1), int(rows.max()+1))
    margins = (box[0], box[1], image.width-box[2], image.height-box[3])
    if min(margins) < RING_RADIUS:
        raise ValueError(f"outline ring truncated: margins={margins}, required radius={RING_RADIUS}")
    w, h = box[2]-box[0], box[3]-box[1]
    normalized = image.crop(box).resize((round(w*64/h), 64), Image.Resampling.NEAREST)
    normal_rgb = np.asarray(normalized.convert("RGB"))
    normal_luma = normal_rgb @ LUMA
    normal_balanced = normal_rgb.astype(float) * (255 / np.array(tint))
    core = (normal_balanced @ LUMA >= 180) & (normal_balanced.max(2)-normal_balanced.min(2) <= MAX_STROKE_CHROMA)
    # Exclude frame edges: crops must have sufficient margin around the glyph.
    expanded = np.asarray(Image.fromarray(bright.astype("uint8")*255).filter(ImageFilter.MaxFilter(2*RING_RADIUS+1))) > 0
    ring = expanded & ~bright
    return {"box": box, "margins": margins, "width": w, "height": h,
            "brightFraction": float(core.mean()), "coreLuma": float(normal_luma[core].mean()),
            "ringLuma": float(luminance[ring].mean()),
            "ringDarkFraction": float((luminance[ring] < 80).mean())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native", type=Path, default=Path(".local/native-topbar-reference-2560.png"))
    parser.add_argument("--ours", type=Path, default=Path(".local/sdf-browser/matched-2560.png"))
    parser.add_argument("--labels", type=Path, default=Path(".local/sdf-browser/matched-labels.json"))
    parser.add_argument("--out", type=Path, default=Path(".local/sdf-browser/native-metrics.json"))
    parser.add_argument("--old-tint", action="store_true", help="segment the uncalibrated peach CSS baseline")
    parser.add_argument("--check", action="store_true", help="fail unless every label meets the fixed tolerances")
    args = parser.parse_args()
    labels = json.loads(args.labels.read_text())
    require_expected_labels(labels)
    native, ours = Image.open(args.native).convert("RGB"), Image.open(args.ours).convert("RGB")
    if native.size != (2560, 1440):
        raise ValueError("expected the supplied unscaled 2560x1440 capture")
    results = []
    comparison = Image.new("RGB", (1100, 6*90+24), (80, 80, 80))
    draw = ImageDraw.Draw(comparison)
    draw.text((8, 5), "Native DE build185872 - bright glyph height normalized to64px", fill="white")
    draw.text((558, 5), "Ours - same64px bright height (nearest; no added smoothing)", fill="white")
    proof_comparison = comparison.copy()
    ImageDraw.Draw(proof_comparison).rectangle((550, 0, 1100, 24), fill=(80, 80, 80))
    ImageDraw.Draw(proof_comparison).text((558, 5), "Ours RGBA on estimated native background (outline control)", fill="white")
    for i, (text, native_box, label) in enumerate(zip(LABELS, NATIVE_BOXES, labels, strict=True)):
        x, y, w, h = (label[k] for k in ("x", "y", "width", "height"))
        a = native.crop(native_box)
        b = ours.crop((int(x)-2, int(y)-2, int(x+w)+3, int(y+h)+3))
        ma, mb = measure(a), measure(b, (250, 230, 211) if args.old_tint else (255, 255, 255))
        # The native Byzantine panel is lighter than our Western black panel.
        # Also test the exported RGBA glyph on the native patch's median clean
        # top3-row background, so black panel art cannot conceal a weak outline.
        backdrop = tuple(map(int, np.median(np.asarray(a)[:3].reshape(-1, 3), axis=0)))
        layer = Image.open(io.BytesIO(base64.b64decode(label["png"].split(",")[1]))).convert("RGBA")
        proof = Image.new("RGBA", (layer.width+4, layer.height+4), backdrop+(255,))
        proof.alpha_composite(layer, (2, 2))
        backdrop_metric = measure(proof, (250, 230, 211) if args.old_tint else (255, 255, 255))
        results.append({"text": text, "native": ma, "ours": mb,
                        "estimatedNativeBackdrop": backdrop, "onNativeBackdrop": backdrop_metric})
        # Each side uses its own bright bounds, same 64px height and 4px margin.
        for col, (image, metric) in enumerate(((a, ma), (b, mb))):
            l, t, r, bottom = metric["box"]
            crop = image.crop((l-1, t-1, r+1, bottom+1))
            factor = 64/metric["height"]
            crop = crop.resize((round(crop.width*factor), round(crop.height*factor)), Image.Resampling.NEAREST)
            comparison.paste(crop, (col*550+8, i*90+32))
        for col, (image, metric) in enumerate(((a, ma), (proof, backdrop_metric))):
            l, t, r, bottom = metric["box"]
            crop = image.crop((l-1, t-1, r+1, bottom+1))
            factor = 64/metric["height"]
            crop = crop.resize((round(crop.width*factor), round(crop.height*factor)), Image.Resampling.NEAREST)
            proof_comparison.paste(crop, (col*550+8, i*90+32))
    args.out.write_text(json.dumps(results, indent=2)+"\n")
    comparison.save(args.out.with_suffix(".png"))
    proof_comparison.save(args.out.with_name(args.out.stem+"-background-proof.png"))
    original = Image.new("RGB", (2240, 106), (80, 80, 80))
    draw = ImageDraw.Draw(original)
    draw.text((8, 5), "Native DE - original2560x1440 display scale", fill="white")
    draw.text((1128, 5), "Ours - original2560x1440 display scale", fill="white")
    original.paste(native.crop((0, 0, 1120, 82)), (0, 24))
    original.paste(ours.crop((0, 0, 1120, 82)), (1120, 24))
    original.save(args.out.with_name(args.out.stem+"-original-scale.png"))
    print(json.dumps(results, indent=2))
    if args.check:
        require_expected_labels(results)
        failures = [f"{row['text']}: {key} delta={row['ours'][key]-row['native'][key]:.4f}, tolerance={tolerance}"
                    for row in results for key, tolerance in TOLERANCES.items()
                    if abs(row['ours'][key]-row['native'][key]) > tolerance]
        failures += [f"{row['text']}: height differs by more than1 native pixel"
                     for row in results if abs(row['ours']['height']-row['native']['height']) > 1]
        failures += [f"{row['text']}: outline on estimated native background differs by more than25/255"
                     for row in results if abs(row['onNativeBackdrop']['ringLuma']-row['native']['ringLuma']) > 25]
        if failures:
            raise AssertionError("\n".join(failures))


if __name__ == "__main__":
    main()
