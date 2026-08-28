#!/usr/bin/env python3
"""Decode SLD sprite layers: the BC1 main graphics and the BC4 masks.

The pinned openage decoder corrupts the heap on the BC4 mask layers
(reproducible `malloc.c` assertion failure; the same defect is on current
upstream, so there is no revision to move to) and crashes outright on some
main layers (the stable). The container and DXT1/DXT4 block formats are
publicly documented, so this reads them directly instead: no openage code is
involved, and this module fully replaces it in the import path.

Layout, per the format documentation:
  file header    "< 4s 4H I"   signature, version, frame count, ...
  frame header   "< 4H 2B H"   canvas size, canvas hotspot, layer bitfield, ...
  per layer      "< I"         byte length, counted from the length field
                               itself, then padded to a 4-byte boundary
  graphics layer "< 4H 2B"     bounding box in the canvas, flags
Pixels follow as a command array of (skip, draw) counts over a row-major grid
of 4x4 blocks, then that many 8-byte blocks: BC1 (RGB565 pair + 2-bit indices)
for the main layer, BC4 (byte pair + 3-bit indices) for the masks.
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
BC1_BLOCK = Struct("< 2H I")

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
    """One frame's mask coverage: `width * height` bytes, 0 = not covered."""

    width: int
    height: int
    # Hotspot in layer space, so a caller can anchor the mask exactly where the
    # main sprite's hotspot sits.
    hotspot_x: int
    hotspot_y: int
    alpha: bytearray

    channels = 1

    @property
    def pixels(self) -> bytearray:
        return self.alpha

    @property
    def empty(self) -> bool:
        return self.width == 0 or self.height == 0 or not any(self.alpha)


@dataclass
class ColorFrame:
    """One frame of the main graphics layer: `width * height` RGBA bytes."""

    width: int
    height: int
    hotspot_x: int
    hotspot_y: int
    rgba: bytearray

    channels = 4

    @property
    def pixels(self) -> bytearray:
        return self.rgba

    @property
    def empty(self) -> bool:
        return self.width == 0 or self.height == 0 or not any(self.rgba[3::4])


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


def _rgb565(value: int) -> tuple[int, int, int]:
    """Expand one R5G6B5 colour to 8-bit channels by shifting."""
    return ((value >> 11) << 3, ((value >> 5) & 0x3F) << 2, (value & 0x1F) << 3)


def _bc1_lookup(color0: int, color1: int) -> list[tuple[int, int, int, int]]:
    """The 4 RGBA values a BC1 block's 2-bit indices select."""
    a = _rgb565(color0)
    b = _rgb565(color1)
    table = [(*a, 255), (*b, 255)]
    if color0 > color1:
        table.append((*((2 * x + y + 1) // 3 for x, y in zip(a, b)), 255))
        table.append((*((x + 2 * y + 1) // 3 for x, y in zip(a, b)), 255))
    else:
        table.append((*((x + y + 1) // 2 for x, y in zip(a, b)), 255))
        table.append((0, 0, 0, 0))
    return table


def _decode_bc1_block(data: bytes, offset: int) -> list[int]:
    """Expand one 8-byte BC1 block to 16 RGBA pixels (64 bytes), row-major."""
    color0, color1, indices = BC1_BLOCK.unpack_from(data, offset)
    table = _bc1_lookup(color0, color1)
    values: list[int] = []
    for _ in range(16):
        values.extend(table[indices & 0b11])
        indices >>= 2
    return values


def _decode_layer(
    data: bytes,
    width: int,
    height: int,
    command_offset: int,
    command_count: int,
    reuse_previous: bool,
    previous: MaskFrame | ColorFrame | None,
    previous_offset: tuple[int, int],
    layer_offset: tuple[int, int],
    channels: int = 1,
    decode_block: Any = _decode_block,
) -> bytearray:
    pixels = bytearray(width * height * channels)
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
            start = (y * width + origin_x) * channels
            span = min(BLOCK, width - origin_x) * channels
            source = row * BLOCK * channels
            pixels[start:start + span] = bytes(values[source:source + span])

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
                destination = (y * width + x) * channels
                source = (sy * previous.width + sx) * channels
                pixels[destination:destination + channels] = \
                    previous.pixels[source:source + channels]

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
            put(index, decode_block(data, cursor))
            cursor += 8
            index += 1
    return pixels


# The outline layer is not a BC4 mask. Its payload is a per-block-row command
# stream: a byte under 0x80 skips that many 4x4 blocks, 0x80|n draws n of them
# from two bytes each, and those 16 bits are the block's pixels row by row,
# least significant bit first. A `u16` offset per block row indexes into the
# stream, after the same two header bytes the other masks carry. The walk is
# exact - every row's commands cover the row's blocks and consume its bytes to
# the byte - which is what proves the reading.
OUTLINE_ROW = Struct("< H")


def decode_outline_layer(payload: bytes, width: int, height: int) -> bytearray:
    """Expand one frame's outline layer to `width * height` bytes, 0 or 255."""
    pixels = bytearray(width * height)
    blocks_x = (width + BLOCK - 1) // BLOCK
    blocks_y = (height + BLOCK - 1) // BLOCK
    table = MASK_HEADER.size
    body_start = table + blocks_y * OUTLINE_ROW.size
    body = payload[body_start:]
    for row in range(blocks_y):
        start = OUTLINE_ROW.unpack_from(payload, table + row * OUTLINE_ROW.size)[0]
        end = (
            OUTLINE_ROW.unpack_from(payload, table + (row + 1) * OUTLINE_ROW.size)[0]
            if row + 1 < blocks_y else len(body)
        )
        cursor = start
        column = 0
        while cursor < end:
            command = body[cursor]
            cursor += 1
            if command < 0x80:
                column += command
                continue
            for _ in range(command & 0x7F):
                if cursor + 2 > len(body):
                    break
                bits = body[cursor] | (body[cursor + 1] << 8)
                cursor += 2
                for bit in range(16):
                    if not (bits >> bit) & 1:
                        continue
                    y = row * BLOCK + bit // BLOCK
                    x = column * BLOCK + bit % BLOCK
                    if y < height and x < width:
                        pixels[y * width + x] = 255
                column += 1
        if column != blocks_x or cursor != end:
            raise ValueError(
                f"outline row {row}: covered {column} of {blocks_x} blocks, "
                f"consumed {cursor - start} of {end - start} bytes"
            )
    return pixels


def decode_outlines(data: bytes) -> list[MaskFrame | None]:
    """Every frame's outline contour, or None where a frame carries none."""
    return _decode_wanted(data, LAYER_OUTLINE, MaskFrame, 1, _decode_block)


def decode_masks(data: bytes, wanted: int = LAYER_SHADOW) -> list[MaskFrame | None]:
    """Every frame's mask for `wanted`, or None where a frame carries none.

    `wanted` must be a BC4 layer: LAYER_SHADOW or LAYER_PLAYERCOLOR.
    """
    return _decode_wanted(data, wanted, MaskFrame, 1, _decode_block)


def decode_colors(data: bytes) -> list[ColorFrame | None]:
    """Every frame's BC1 main graphics layer as RGBA."""
    return _decode_wanted(data, LAYER_MAIN, ColorFrame, 4, _decode_bc1_block)


def _decode_wanted(
    data: bytes, wanted: int, factory: Any, channels: int, decode_block: Any
) -> list[Any]:
    signature, _version, frame_count, _u1, frame_start, _u3 = FILE_HEADER.unpack_from(data, 0)
    if signature != b"SLDX":
        raise ValueError(f"not an SLD file: {signature!r}")

    frames: list[Any] = []
    previous: MaskFrame | ColorFrame | None = None
    previous_offset = (0, 0)
    # The field the format documentation records as "unknown, always 0x10" is
    # where the frame data starts: 16 in almost every file, but 14 in
    # b_west_stable_age2_x1.sld. Decoders that hardcode 16 read that file two
    # bytes out of phase, which is why the previously used one crashed on it.
    offset = frame_start

    for _ in range(frame_count):
        _cw, _ch, hotspot_x, hotspot_y, frame_type, _unknown, _index = \
            FRAME_HEADER.unpack_from(data, offset)
        offset += FRAME_HEADER.size

        found: MaskFrame | ColorFrame | None = None
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
            elif mask in (LAYER_DAMAGE, LAYER_PLAYERCOLOR, LAYER_OUTLINE):
                flags, _unknown1 = MASK_HEADER.unpack_from(data, cursor)
                box = main_box
                if mask != LAYER_OUTLINE:
                    cursor += MASK_HEADER.size

            if mask == wanted == LAYER_OUTLINE and box is not None:
                if flags & FLAG_REUSE_PREVIOUS:
                    # Never seen; the outline stream has no way to inherit
                    # blocks, so a file that asks would decode wrong in silence.
                    raise ValueError("outline layer asks to reuse the previous frame")
                x1, y1, x2, y2 = box
                width, height = x2 - x1, y2 - y1
                found = factory(
                    width, height, hotspot_x - x1, hotspot_y - y1,
                    decode_outline_layer(data[cursor:start + length], width, height),
                )
            elif mask == wanted and box is not None:
                x1, y1, x2, y2 = box
                width, height = x2 - x1, y2 - y1
                count = COMMAND_COUNT.unpack_from(data, cursor)[0]
                pixels = _decode_layer(
                    data, width, height, cursor, count,
                    bool(flags & FLAG_REUSE_PREVIOUS), previous, previous_offset, (x1, y1),
                    channels, decode_block,
                )
                found = factory(width, height, hotspot_x - x1, hotspot_y - y1, pixels)
                previous_offset = (x1, y1)

            # Remaining layer kinds are skipped wholesale via the length
            # field. The 4-byte padding is relative to the frame data start:
            # equivalent to absolute alignment when frames start at 16, but
            # not in the stable, whose frames start at 14.
            offset = start + length
            offset += (BLOCK - (offset - frame_start)) % BLOCK

        frames.append(found)
        if found is not None:
            previous = found
    return frames


# WebGPU's default maxTextureDimension2D. A sheet over this limit does not
# error anywhere: the texture silently fails to sample and the sprite renders
# as a solid box (issue #30, the unpacked trebuchet's 1920-frame attack).
MAX_SHEET = 8192


def _shelf_pack(
    usable: list[MaskFrame | ColorFrame | None],
) -> tuple[list[dict[str, int]], int, int]:
    """Shelf packing in rows about as wide as the widest frame allows, keeping
    the sheet roughly square without a bin-packing dependency. Absent frames
    keep a zero-sized entry to hold their position in the sequence.

    A sheet whose square layout would pass MAX_SHEET is capped at it and packed
    tallest-first instead, so rows hold frames of similar height and the capped
    width still fits everything under the limit. Placements are indexed by
    frame, so the physical order on the sheet is free to differ."""
    boxes = [(f.width, f.height) if f else (0, 0) for f in usable]
    widest = max((w for w, _ in boxes), default=1)
    columns = max(1, int(len(usable) ** 0.5))
    sheet_width = max(1, widest * columns)
    order = list(range(len(usable)))
    if sheet_width > MAX_SHEET:
        sheet_width = MAX_SHEET
        order.sort(key=lambda index: -boxes[index][1])

    placements: list[dict[str, int] | None] = [None] * len(usable)
    x = y = row_height = 0
    for index in order:
        width, height = boxes[index]
        frame = usable[index]
        if width == 0 or frame is None:
            placements[index] = {"x": 0, "y": 0, "w": 0, "h": 0, "cx": 0, "cy": 0}
            continue
        if x + width > sheet_width and x > 0:
            x = 0
            y += row_height
            row_height = 0
        placements[index] = {
            "x": x, "y": y, "w": width, "h": height,
            "cx": frame.hotspot_x, "cy": frame.hotspot_y,
        }
        x += width
        row_height = max(row_height, height)
    sheet_height = max(1, y + row_height)
    if sheet_width > MAX_SHEET or sheet_height > MAX_SHEET:
        raise ValueError(
            f"atlas would be {sheet_width}x{sheet_height}, over the {MAX_SHEET} device limit"
        )
    return placements, sheet_width, sheet_height


def pack_mask_atlas(frames: list[MaskFrame | None], limit: int) -> tuple[Any, dict[str, Any]]:
    """Pack the first `limit` masks into one greyscale-alpha atlas.

    Frame order matches the main layer, so the renderer reuses the frame index
    it already computed.
    """
    from PIL import Image

    usable = [f if (f is not None and not f.empty) else None for f in frames[:limit]]
    placements, sheet_width, sheet_height = _shelf_pack(usable)

    image = Image.new("L", (sheet_width, sheet_height), 0)
    for placement, frame in zip(placements, usable):
        if frame is None or placement["w"] == 0:
            continue
        image.paste(
            Image.frombytes("L", (frame.width, frame.height), bytes(frame.alpha)),
            (placement["x"], placement["y"]),
        )
    # White with the mask as alpha. The renderer multiplies its own colour
    # through this, so the sheet has to stay neutral: baking a colour in here
    # would multiply to that colour, and baking black would multiply to black.
    rgba = Image.merge("RGBA", [Image.new("L", image.size, 255)] * 3 + [image])
    return rgba, {
        "size": [sheet_width, sheet_height],
        "framesInFile": len(placements),
        "frames": placements,
    }


def luminance(red: int, green: int, blue: int) -> int:
    """Rec. 601 luma, the shade a player-colour pixel is drawn at."""
    return (red * 299 + green * 587 + blue * 114) // 1000


def pack_playercolor_atlas(
    masks: list[MaskFrame | None], colors: list[ColorFrame | None], limit: int
) -> tuple[Any, dict[str, Any]]:
    """Pack the first `limit` player-colour masks as shade + coverage.

    The mask layer is coverage: its interior is a solid 255 and only the block
    edges hold intermediate values. The shading of the cloth lives in the main
    layer, which paints those pixels in greys, so the ramp index the renderer
    needs is the main layer's luma there and the mask is its alpha. The mask
    layer carries no geometry of its own - it covers the main layer's box - so
    the two frames are the same size and index alike.
    """
    from PIL import Image

    usable = [f if (f is not None and not f.empty) else None for f in masks[:limit]]
    placements, sheet_width, sheet_height = _shelf_pack(usable)

    shade = Image.new("L", (sheet_width, sheet_height), 0)
    coverage = Image.new("L", (sheet_width, sheet_height), 0)
    for index, (placement, frame) in enumerate(zip(placements, usable)):
        if frame is None or placement["w"] == 0:
            continue
        color = colors[index] if index < len(colors) else None
        if color is None or (color.width, color.height) != (frame.width, frame.height):
            raise ValueError(f"frame {index}: player-colour mask does not match the main layer")
        levels = bytes(
            luminance(color.rgba[i * 4], color.rgba[i * 4 + 1], color.rgba[i * 4 + 2])
            for i in range(frame.width * frame.height)
        )
        shade.paste(Image.frombytes("L", (frame.width, frame.height), levels),
                    (placement["x"], placement["y"]))
        coverage.paste(Image.frombytes("L", (frame.width, frame.height), bytes(frame.alpha)),
                       (placement["x"], placement["y"]))
    rgba = Image.merge("RGBA", [shade] * 3 + [coverage])
    return rgba, {
        "size": [sheet_width, sheet_height],
        "framesInFile": len(placements),
        "frames": placements,
    }


def pack_color_atlas(frames: list[ColorFrame | None], limit: int) -> tuple[Any, dict[str, Any]]:
    """Pack the first `limit` main-layer frames into one RGBA atlas."""
    from PIL import Image

    usable = [f if (f is not None and not f.empty) else None for f in frames[:limit]]
    placements, sheet_width, sheet_height = _shelf_pack(usable)

    image = Image.new("RGBA", (sheet_width, sheet_height), (0, 0, 0, 0))
    for placement, frame in zip(placements, usable):
        if frame is None or placement["w"] == 0:
            continue
        image.paste(
            Image.frombytes("RGBA", (frame.width, frame.height), bytes(frame.rgba)),
            (placement["x"], placement["y"]),
        )
    return image, {
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
