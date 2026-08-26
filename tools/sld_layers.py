#!/usr/bin/env python3
"""Decode the BC4 mask layers of an SLD sprite to 8-bit coverage masks.

The pinned openage decoder corrupts the heap on this layer (reproducible
`malloc.c` assertion failure; the same defect is on current upstream, so there
is no revision to move to), which is why only the main layer was imported. The
container and DXT4/BC4 block formats are publicly documented, so this reads
them directly instead: no openage code is involved, and a failure here cannot
take down the main-layer conversion.

Layout, per the format documentation:
  file header    "< 4s 4H I"   signature, version, frame count, ...
  frame header   "< 4H 2B H"   canvas size, canvas hotspot, layer bitfield, ...
  per layer      "< I"         byte length, counted from the length field
                               itself, then padded to a 4-byte boundary
  graphics layer "< 4H 2B"     bounding box in the canvas, flags
Pixels follow as a command array of (skip, draw) counts over a row-major grid
of 4x4 blocks, then that many 8-byte BC4 blocks.
"""

from __future__ import annotations

from dataclasses import dataclass
from struct import Struct
from typing import Any

FILE_HEADER = Struct("< 4s 4H I")
FRAME_HEADER = Struct("< 4H 2B H")
LAYER_LENGTH = Struct("< I")
GRAPHICS_HEADER = Struct("< 4H 2B")
MASK_HEADER = Struct("< 2B")
COMMAND_COUNT = Struct("< H")

# frame_type bits. The format documentation tabulates these most-significant
# first, but its own worked example (0x17 = main, shadow, outline, playercolor)
# is least-significant first, which is what the files actually use.
LAYER_MAIN = 0x01
LAYER_SHADOW = 0x02
LAYER_OUTLINE = 0x04
LAYER_DAMAGE = 0x08
LAYER_PLAYERCOLOR = 0x10

# flag1 bit 0: blocks this frame skips are inherited from the previous frame
# rather than left empty.
FLAG_REUSE_PREVIOUS = 0x80

BLOCK = 4


@dataclass
class MaskFrame:
    """One frame's shadow coverage: `width * height` bytes, 0 = no shadow."""

    width: int
    height: int
    # Hotspot in layer space, so a caller can anchor the mask exactly where the
    # main sprite's hotspot sits.
    hotspot_x: int
    hotspot_y: int
    alpha: bytearray

    @property
    def empty(self) -> bool:
        return self.width == 0 or self.height == 0 or not any(self.alpha)


def _bc4_lookup(color0: int, color1: int) -> list[int]:
    """The 8 single-channel values a BC4 block's 3-bit indices select."""
    table = [color0, color1]
    if color0 > color1:
        table += [((7 - i) * color0 + i * color1) // 7 for i in range(1, 7)]
    else:
        table += [((5 - i) * color0 + i * color1) // 5 for i in range(1, 5)]
        table += [0, 255]
    return table


def _decode_block(data: bytes, offset: int) -> list[int]:
    """Expand one 8-byte BC4 block to 16 values in row-major order."""
    table = _bc4_lookup(data[offset], data[offset + 1])
    values: list[int] = []
    for half in range(2):
        base = offset + 2 + half * 3
        indices = data[base] | (data[base + 1] << 8) | (data[base + 2] << 16)
        for _ in range(8):
            values.append(table[indices & 0b111])
            indices >>= 3
    return values


def _decode_layer(
    data: bytes,
    width: int,
    height: int,
    command_offset: int,
    command_count: int,
    reuse_previous: bool,
    previous: MaskFrame | None,
    previous_offset: tuple[int, int],
    layer_offset: tuple[int, int],
) -> bytearray:
    alpha = bytearray(width * height)
    blocks_x = (width + BLOCK - 1) // BLOCK
    blocks_y = (height + BLOCK - 1) // BLOCK
    total_blocks = blocks_x * blocks_y
    block_data = command_offset + COMMAND_COUNT.size + command_count * 2

    def put(index: int, values: list[int]) -> None:
        origin_x = (index % blocks_x) * BLOCK
        origin_y = (index // blocks_x) * BLOCK
        for row in range(BLOCK):
            y = origin_y + row
            if y >= height:
                break
            start = y * width + origin_x
            span = min(BLOCK, width - origin_x)
            alpha[start:start + span] = bytes(values[row * BLOCK:row * BLOCK + span])

    def inherit(index: int) -> None:
        """Copy a skipped block from the previous frame, which may sit at a
        different position in the canvas."""
        if previous is None:
            return
        canvas_x = (index % blocks_x) * BLOCK + layer_offset[0]
        canvas_y = (index // blocks_x) * BLOCK + layer_offset[1]
        src_x = canvas_x - previous_offset[0]
        src_y = canvas_y - previous_offset[1]
        for row in range(BLOCK):
            y = canvas_y - layer_offset[1] + row
            sy = src_y + row
            if y >= height or not (0 <= sy < previous.height):
                continue
            for column in range(BLOCK):
                x = canvas_x - layer_offset[0] + column
                sx = src_x + column
                if x >= width or not (0 <= sx < previous.width):
                    continue
                alpha[y * width + x] = previous.alpha[sy * previous.width + sx]

    index = 0
    cursor = block_data
    for command in range(command_count):
        skip, draw = data[command_offset + COMMAND_COUNT.size + command * 2:
                          command_offset + COMMAND_COUNT.size + command * 2 + 2]
        if reuse_previous:
            for _ in range(skip):
                if index >= total_blocks:
                    break
                inherit(index)
                index += 1
        else:
            index += skip
        for _ in range(draw):
            if index >= total_blocks or cursor + 8 > len(data):
                break
            put(index, _decode_block(data, cursor))
            cursor += 8
            index += 1
    return alpha


def decode_masks(data: bytes, wanted: int = LAYER_SHADOW) -> list[MaskFrame | None]:
    """Every frame's mask for `wanted`, or None where a frame carries none.

    `wanted` must be a BC4 layer: LAYER_SHADOW or LAYER_PLAYERCOLOR.
    """
    signature, _version, frame_count, _u1, _u2, _u3 = FILE_HEADER.unpack_from(data, 0)
    if signature != b"SLDX":
        raise ValueError(f"not an SLD file: {signature!r}")

    frames: list[MaskFrame | None] = []
    previous: MaskFrame | None = None
    previous_offset = (0, 0)
    offset = FILE_HEADER.size

    for _ in range(frame_count):
        _cw, _ch, hotspot_x, hotspot_y, frame_type, _unknown, _index = \
            FRAME_HEADER.unpack_from(data, offset)
        offset += FRAME_HEADER.size

        found: MaskFrame | None = None
        # The mask layers carry no geometry of their own; they cover the main
        # layer, so its box has to be read first and carried across.
        main_box = (0, 0, 0, 0)
        for mask in (LAYER_MAIN, LAYER_SHADOW, LAYER_OUTLINE, LAYER_DAMAGE, LAYER_PLAYERCOLOR):
            if not frame_type & mask:
                continue
            start = offset
            length = LAYER_LENGTH.unpack_from(data, offset)[0]
            cursor = offset + LAYER_LENGTH.size
            box: tuple[int, int, int, int] | None = None
            flags = 0

            if mask in (LAYER_MAIN, LAYER_SHADOW):
                x1, y1, x2, y2, flags, _unknown1 = GRAPHICS_HEADER.unpack_from(data, cursor)
                cursor += GRAPHICS_HEADER.size
                box = (x1, y1, x2, y2)
                if mask == LAYER_MAIN:
                    main_box = box
            elif mask in (LAYER_DAMAGE, LAYER_PLAYERCOLOR):
                flags, _unknown1 = MASK_HEADER.unpack_from(data, cursor)
                cursor += MASK_HEADER.size
                box = main_box

            if mask == wanted and box is not None:
                x1, y1, x2, y2 = box
                width, height = x2 - x1, y2 - y1
                count = COMMAND_COUNT.unpack_from(data, cursor)[0]
                alpha = _decode_layer(
                    data, width, height, cursor, count,
                    bool(flags & FLAG_REUSE_PREVIOUS), previous, previous_offset, (x1, y1),
                )
                found = MaskFrame(width, height, hotspot_x - x1, hotspot_y - y1, alpha)
                previous_offset = (x1, y1)

            # Remaining layer kinds are skipped wholesale via the length field.
            offset = start + length
            offset += (BLOCK - offset) % BLOCK

        frames.append(found)
        if found is not None:
            previous = found
    return frames


def pack_mask_atlas(frames: list[MaskFrame | None], limit: int) -> tuple[Any, dict[str, Any]]:
    """Pack the first `limit` masks into one greyscale-alpha atlas.

    Frame order matches the main layer, so the renderer reuses the frame index
    it already computed. Absent masks keep a zero-sized entry to hold position.
    """
    from PIL import Image

    usable = [f if (f is not None and not f.empty) else None for f in frames[:limit]]
    boxes = [(f.width, f.height) if f else (0, 0) for f in usable]
    widest = max((w for w, _ in boxes), default=1)
    # Shelf packing in rows about as wide as the widest frame allows, keeping
    # the sheet roughly square without a bin-packing dependency.
    columns = max(1, int(len(usable) ** 0.5))
    sheet_width = max(1, widest * columns)

    placements: list[dict[str, int]] = []
    x = y = row_height = 0
    for (width, height), frame in zip(boxes, usable):
        if width == 0 or frame is None:
            placements.append({"x": 0, "y": 0, "w": 0, "h": 0, "cx": 0, "cy": 0})
            continue
        if x + width > sheet_width and x > 0:
            x = 0
            y += row_height
            row_height = 0
        placements.append({
            "x": x, "y": y, "w": width, "h": height,
            "cx": frame.hotspot_x, "cy": frame.hotspot_y,
        })
        x += width
        row_height = max(row_height, height)
    sheet_height = max(1, y + row_height)

    image = Image.new("L", (sheet_width, sheet_height), 0)
    for placement, frame in zip(placements, usable):
        if frame is None or placement["w"] == 0:
            continue
        image.paste(
            Image.frombytes("L", (frame.width, frame.height), bytes(frame.alpha)),
            (placement["x"], placement["y"]),
        )
    # Black with the mask as alpha: the renderer tints and fades it per entity.
    rgba = Image.merge("RGBA", [Image.new("L", image.size, 0)] * 3 + [image])
    return rgba, {
        "size": [sheet_width, sheet_height],
        "framesInFile": len(placements),
        "frames": placements,
    }


def mask_summary(frames: list[MaskFrame | None]) -> dict[str, Any]:
    present = [f for f in frames if f is not None and not f.empty]
    return {
        "frames": len(frames),
        "withShadow": len(present),
        "maxSize": [max((f.width for f in present), default=0),
                    max((f.height for f in present), default=0)],
    }
