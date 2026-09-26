"""Compose owned wall candidates against their hotspots, outside publication.

uv run --locked python tools/probes/building_wall_art.py /tmp/opencode/walls.png
Rows per material: single frames, x runs, y runs, the two diagonals.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from depot import depot_root, Graphics, uhd_graphics_dir
from sld_layers import decode_colors
from PIL import Image, ImageDraw

root = depot_root()
graphics = Graphics(root / 'depot_813784/resources/_common/drs/graphics', uhd_graphics_dir(root))
sheet = Image.new('RGBA', (1500, 1400), (70, 90, 65, 255))
draw = ImageDraw.Draw(sheet)
for row, stem in enumerate(('b_west_wall_stone_x1', 'b_west_wall_fortified_x1')):
    path, scale = graphics.source(stem)
    frames = decode_colors(path.read_bytes())

    def stamp(index, x, y):
        frame = frames[index]
        image = Image.frombytes('RGBA', (frame.width, frame.height), bytes(frame.rgba))
        if scale != 1:
            image = image.resize((frame.width // scale, frame.height // scale))
        sheet.alpha_composite(image, (round(x - frame.hotspot_x / scale), round(y - frame.hotspot_y / scale)))

    for index in range(5):
        x, y = 150 + index * 300, 150 + row * 700
        draw.text((x - 100, y - 120), f'{stem} frame {index}', fill='white')
        stamp(index, x, y)
        for n, (dx, dy) in enumerate(((-48, 24), (48, 24), (96, 0), (0, 48)), 1):
            for a in (-1, 0, 1):
                stamp(index, x + dx * a, y + n * 125 + dy * a)
sheet.save(sys.argv[1])
