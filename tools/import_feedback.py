"""The native in-game WPFG dialogs which supersede widgetui's placeholders.

Read the small subset we render, not a replacement WPF implementation. Nine-
slice pieces retain source pixels; runtime layout consumes the extracted sizes.
"""
from pathlib import Path
import hashlib
import shutil
import xml.etree.ElementTree as ET

from PIL import Image

X = "{http://schemas.microsoft.com/winfx/2006/xaml}"
P = "{http://schemas.microsoft.com/winfx/2006/xaml/presentation}"


def extract_feedback(wpfg: Path, out: Path, hashes: dict) -> dict:
    def source(path):
        hashes[f"wpfg/{path.relative_to(wpfg)}"] = hashlib.sha256(path.read_bytes()).hexdigest()
        return path

    def xml(name):
        return ET.parse(source(wpfg / name)).getroot()

    def named(root, name):
        return next(e for e in root.iter() if e.get(X + "Name") == name)

    def keyed(root, name):
        return next(e for e in root.iter() if e.get(X + "Key") == name)

    def setters(root):
        return {e.get("Property"): e.get("Value") for e in root.findall(P + "Setter")}

    def numbers(value):
        return [float(v) for v in value.split(",")]

    def copy(relative):
        path = source(wpfg / relative)
        target = out / "wpfg" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        return f"wpfg/{relative}"

    images_doc = xml("systemresourcesimages.xaml")
    resources = xml("systemresources.xaml")
    text = xml("SystemResourcesTextBlock.xaml")
    fonts_doc = xml("SystemResourcesFont.xaml")
    yesno = xml("dialog/dialogyesnoboxgeneral.xaml")
    end = xml("dialog/dialogendgame.xaml")
    button = keyed(xml("systemresourcesbuttonlarge.xaml"), "ButtonLarge")
    frame = keyed(xml("SystemResourcesPaphos.xaml"), "DialogBackgroundRect")
    frame_effect = next(e for e in frame.iter() if e.tag.endswith("}Age2NineSliceShinyEffect"))
    image_names = ["dialog2_9slice", "dialog_defeat", "dialog_victory", "seperator", "seperator_grey",
                   "button_large_normal", "button_large_hover", "button_large_active", "button_large_disable", "button_close_cross"]
    images = {name: copy(keyed(images_doc, name).get("ImageSource").lstrip("/")) for name in image_names}

    def slices(name, effect):
        left, top = numbers(effect.get("P1"))
        right, bottom = numbers(effect.get("P2"))
        with Image.open(out / images[name]) as picture:
            w, h = picture.size
            xs, ys = [0, int(left), w - int(right), w], [0, int(top), h - int(bottom), h]
            paths = []
            for y in range(3):
                for x in range(3):
                    relative = f"wpfg/slices/{name}-{y}-{x}.png"
                    target = out / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    picture.crop((xs[x], ys[y], xs[x+1], ys[y+1])).save(target)
                    paths.append(relative)
        return {"images": paths, "columns": [left, w - left - right, right], "rows": [top, h - top - bottom, bottom]}

    def gradient(name):
        return [{"color": e.get("Color"), "offset": float(e.get("Offset", "0"))}
                for e in keyed(resources, name).iter(P + "GradientStop")]

    btn = named(yesno, "ButtonYes")
    row_defs = next(e for e in yesno.iter(P + "Grid.RowDefinitions"))
    end_panel = named(end, "panel_defeat")
    end_effect = next(e for e in end_panel.iter() if e.tag.endswith("}Age2NineSliceShiny2Effect"))
    end_grid = next(e for e in end.iter(P + "Grid") if e.get("Canvas.Top") is not None)
    # These resources bind the engine's procedural overlay; the emitter's
    # distribution is not in XAML. Retain their provenance, not invented values.
    xml("emberwindow.xaml")
    xml("applicationwindow.xaml")
    xml("screenwindow.xaml")
    return {
        "images": images,
        "fonts": {name: copy(f"fonts/{file}") for name, file in {
            "body": "timesbd.ttf", "heading": "TrajanPro-Regular.ttf", "button": "TrajanPro-Bold.ttf",
        }.items()},
        "fontFamilies": {name: keyed(fonts_doc, name).text for name in ("Body2", "TrajanPro")},
        "button": {"height": float(setters(button)["Height"]), "fontSize": float(setters(button)["FontSize"]),
                   "border": float(next(e for e in button.iter(P + "Border")).get("BorderThickness")),
                   "borderColor": keyed(resources, "ControlBorder").text,
                   "gradient": gradient("ButtonForegroundBrush")},
        "confirm": {"messageWidth": float(named(yesno, "Message").get("Width")),
                    "fontSize": float(setters(keyed(text, "TextBlockGreyMed"))["FontSize"]),
                    "rows": [e.get("Height") for e in row_defs],
                    "buttonWidth": float(btn.get("Width")), "buttonMargin": numbers(btn.get("Margin")),
                    "side": float(next(e for e in yesno.iter(P + "ColumnDefinition")).get("Width")),
                    "close": [float(named(yesno, "ButtonCancel").get(k)) for k in ("Width", "Height")],
                    "gradient": gradient("TextForegroundBrush"), "frame": slices("dialog2_9slice", frame_effect)},
        "end": {"frame": {key: float(end_panel.get(attr)) for key, attr in {
                    "left": "Canvas.Left", "top": "Canvas.Top", "width": "Width", "height": "Height"}.items()},
                "defeat": slices("dialog_defeat", end_effect), "victory": slices("dialog_victory", end_effect),
                "gridTop": float(end_grid.get("Canvas.Top")), "gridHeight": float(end_grid.get("Height")),
                "rows": [dict(e.attrib) for e in end_grid.find(P + "Grid.RowDefinitions")],
                "fontSize": float(named(end, "title_defeat").get("FontSize")),
                "titleRows": [e.get("Height") for e in next(e for e in end.iter(P + "Grid") if e.get("Grid.Row") == "1").find(P + "Grid.RowDefinitions")],
                "buttonWidth": float(named(end, "ButtonSpectate").get("Width")),
                "buttonGap": float(next(e for e in end.iter(P + "ColumnDefinition") if e.get("Width", "").isdigit()).get("Width")),
                "separator": [float(named(end, "seperator_defeat").get(k)) for k in ("Width", "Height")],
                "defeatGradient": gradient("HeadingGradientGreyBrush"), "victoryGradient": gradient("HeadingGradientBrush")},
    }
