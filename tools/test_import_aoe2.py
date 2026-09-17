from functools import lru_cache
from pathlib import Path
import json
import shutil
import sys
import tempfile
import unittest

from PIL import Image

from depot import depot_root
from import_content import extract
from import_ui import extract_ui
from import_audio import import_audio, read_banks, resolve_event
from convert_sld import convert, convert_terrain


ROOT = depot_root()
DAT = ROOT / "depot_813781/resources/_common/dat/empires2_x2_p1.dat"
SOUNDS = ROOT / "depot_813781/resources/_common/dat/sounds.json"
GRAPHICS = ROOT / "depot_813784/resources/_common/drs/graphics"
PALETTES = ROOT / "depot_813781/resources/_common/palettes"
WIDGETUI = ROOT / "depot_813782/widgetui"
HOTKEYS = ROOT / "depot_813781/resources/_common/dat/hotkeys.json"
STRINGS = ROOT / "depot_813781/resources/en/strings/key-value/key-value-strings-utf8.txt"
TERRAIN = ROOT / "depot_813782/resources/_common/terrain/textures/2x"
AUDIO_PACK = ROOT / "depot_813783/wwise/Base.pck"
SPEC = json.loads(Path(__file__).with_name("import-spec.json").read_text())
SOURCE = Path(__file__).with_name("aoe2-source.json")


@lru_cache(maxsize=1)
def extracted_content():
    return extract(DAT, GRAPHICS, PALETTES, SPEC, json.loads(SOURCE.read_text()), STRINGS)


@lru_cache(maxsize=1)
def _dat():
    from genieutils.datfile import DatFile
    return DatFile.parse(DAT)


@unittest.skipUnless(DAT.is_file(), "owned AoE2DE fixture is not installed")
class ContentImportIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = extracted_content()

    def test_shadow_layer_decodes_against_its_own_block_counts(self):
        # The command array must account for every block in the layer grid, and
        # the drawn blocks must consume the layer's remaining bytes exactly.
        # Both invariants failing silently is what a mis-parsed container looks
        # like, so assert them rather than just eyeballing the output.
        from sld_layers import (COMMAND_COUNT, FILE_HEADER, FRAME_HEADER, GRAPHICS_HEADER,
                                LAYER_LENGTH, LAYER_MAIN, LAYER_SHADOW, decode_masks)
        source = GRAPHICS / "b_dark_barracks_age1_x1.sld"
        data = source.read_bytes()
        offset = FILE_HEADER.size
        _cw, _ch, _hx, _hy, frame_type, _u, _i = FRAME_HEADER.unpack_from(data, offset)
        offset += FRAME_HEADER.size
        checked = 0
        for mask in (LAYER_MAIN, LAYER_SHADOW):
            self.assertTrue(frame_type & mask)
            start = offset
            length = LAYER_LENGTH.unpack_from(data, offset)[0]
            cursor = offset + LAYER_LENGTH.size
            x1, y1, x2, y2, _flag, _u1 = GRAPHICS_HEADER.unpack_from(data, cursor)
            cursor += GRAPHICS_HEADER.size
            count = COMMAND_COUNT.unpack_from(data, cursor)[0]
            commands = data[cursor + 2:cursor + 2 + count * 2]
            skips = sum(commands[i] for i in range(0, len(commands), 2))
            draws = sum(commands[i + 1] for i in range(0, len(commands), 2))
            blocks = ((x2 - x1 + 3) // 4) * ((y2 - y1 + 3) // 4)
            self.assertEqual(skips + draws, blocks)
            self.assertEqual(draws * 8, length - (cursor + 2 + count * 2 - start))
            checked += 1
            offset = start + length
            offset += (4 - offset) % 4
        self.assertEqual(checked, 2)

        frame = decode_masks(data)[0]
        self.assertEqual((frame.width, frame.height), (316, 212))
        self.assertTrue(any(frame.alpha))

    def test_delta_frames_inherit_from_the_keyframe_not_the_frame_before(self):
        # The Feudal mill is one keyframe and ninety delta frames, and reading
        # each delta against the frame before it left every earlier sail
        # position behind as a fan of slivers (issue #78). Two proofs that the
        # reference is the last keyframe. First the encoder's own economy: it
        # never draws a block it could have inherited, so no drawn block in a
        # delta frame may equal the keyframe's block at that place -- against
        # the previous frame, thirty thousand of them would.
        from sld_layers import (COMMAND_COUNT, FILE_HEADER, FLAG_DELTA, FRAME_HEADER,
                                GRAPHICS_HEADER, LAYER_LENGTH, LAYER_MAIN, _decode_bc1_block,
                                decode_colors)
        data = (GRAPHICS / "b_west_mill_age2_x1.sld").read_bytes()
        frames = decode_colors(data)
        _sig, _ver, count, _u1, frame_start, _u3 = FILE_HEADER.unpack_from(data, 0)
        offset = frame_start
        keyframe = None
        keyframes = deltas = drawn = 0
        for index in range(count):
            _cw, _ch, _hx, _hy, frame_type, _u, _i = FRAME_HEADER.unpack_from(data, offset)
            offset += FRAME_HEADER.size
            for layer in (0x01, 0x02, 0x04, 0x08, 0x10):
                if not frame_type & layer:
                    continue
                start = offset
                length = LAYER_LENGTH.unpack_from(data, offset)[0]
                cursor = offset + LAYER_LENGTH.size
                if layer == LAYER_MAIN:
                    x1, y1, x2, y2, flags, _ = GRAPHICS_HEADER.unpack_from(data, cursor)
                    cursor += GRAPHICS_HEADER.size
                    commands = COMMAND_COUNT.unpack_from(data, cursor)[0]
                    blocks = cursor + COMMAND_COUNT.size + commands * 2
                    if not flags & FLAG_DELTA:
                        keyframe = (frames[index], x1, y1)
                        keyframes += 1
                    else:
                        deltas += 1
                        reference, kx, ky = keyframe
                        block = 0
                        columns = (x2 - x1 + 3) // 4
                        for command in range(commands):
                            skip, draw = data[cursor + 2 + command * 2:cursor + 4 + command * 2]
                            block += skip
                            for _ in range(draw):
                                values = _decode_bc1_block(data, blocks)
                                blocks += 8
                                if any(values[3::4]):
                                    cx = x1 + (block % columns) * 4 - kx
                                    cy = y1 + (block // columns) * 4 - ky
                                    inherited = []
                                    for row in range(4):
                                        for col in range(4):
                                            px, py = cx + col, cy + row
                                            if 0 <= px < reference.width and 0 <= py < reference.height:
                                                at = (py * reference.width + px) * 4
                                                inherited.extend(reference.rgba[at:at + 4])
                                            else:
                                                inherited.extend((0, 0, 0, 0))
                                    self.assertNotEqual(values, inherited, f"frame {index} block {block}")
                                    drawn += 1
                                block += 1
                offset = start + length
                offset += (4 - (offset - frame_start)) % 4
        self.assertEqual(keyframes, 1)
        self.assertEqual(deltas, 90)
        self.assertGreater(drawn, 100000)
        # Then the picture: the sails sweep round but the mill does not grow.
        # Chained, the opaque count climbed from 27,408 to 30,463 by the end.
        opaque = [sum(1 for alpha in frame.rgba[3::4] if alpha) for frame in frames]
        for index, pixels in enumerate(opaque):
            self.assertLess(abs(pixels - opaque[0]) / opaque[0], 0.05, f"frame {index}: {pixels}")

    def test_playercolor_layer_marks_the_owner_cloth(self):
        from sld_layers import LAYER_PLAYERCOLOR, decode_masks
        source = GRAPHICS / "u_vil_male_lumberjack_walkA_x1.sld"
        frames = decode_masks(source.read_bytes(), LAYER_PLAYERCOLOR)
        marked = [f for f in frames if f is not None and not f.empty]
        # Every walk frame carries the mask, and it covers part of the sprite
        # rather than all or none of it.
        self.assertEqual(len(marked), len(frames))
        frame = marked[0]
        lit = sum(1 for v in frame.alpha if v)
        self.assertGreater(lit, 0)
        self.assertLess(lit, frame.width * frame.height)
        self.assertEqual(max(frame.alpha), 255)

    def test_shadow_sheets_stay_neutral_for_tinting(self):
        # The renderer multiplies its own colour through this sheet, so any
        # colour baked in here multiplies the result: black would render black
        # whatever colour the renderer asked for.
        from convert_sld import convert_mask
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "walk-shadow.png"
            atlas = convert_mask(
                GRAPHICS / "u_vil_male_lumberjack_walkA_x1.sld", out, 30 * 16, "shadow",
            )
            self.assertTrue(atlas)
            with Image.open(out) as image:
                pixels = list(image.convert("RGBA").getdata())  # noqa: PIL deprecation is fine on the pinned version
            lit = [p for p in pixels if p[3] > 0]
            self.assertTrue(lit)
            for red, green, blue, _alpha in lit:
                self.assertEqual((red, green, blue), (255, 255, 255))

    def test_player_colour_sheets_carry_the_shade_and_never_a_colour(self):
        # RGB here is a ramp index, not a colour: the renderer reads it as a
        # grey level and looks it up in the player's palette. A coloured pixel
        # would silently shift the shade of every player.
        from convert_sld import convert_mask
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "walk-playercolor.png"
            atlas = convert_mask(
                GRAPHICS / "u_vil_male_lumberjack_walkA_x1.sld", out, 30 * 16, "playercolor",
            )
            self.assertTrue(atlas)
            with Image.open(out) as image:
                pixels = list(image.convert("RGBA").getdata())  # noqa: PIL deprecation is fine on the pinned version
            lit = [p for p in pixels if p[3] > 0]
            self.assertTrue(lit)
            for red, green, blue, _alpha in lit:
                self.assertEqual(red, green)
                self.assertEqual(green, blue)
            # Cloth is shaded art, so the sheet must span a range of levels
            # rather than the flat 255 a coverage mask would give.
            levels = {p[0] for p in lit}
            self.assertGreater(len(levels), 16)
            self.assertLess(min(levels), 128)

    def test_mask_atlas_frames_track_the_main_layer(self):
        from convert_sld import convert_mask
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "walk-shadow.png"
            atlas = convert_mask(GRAPHICS / "u_vil_male_lumberjack_walkA_x1.sld", out, 30 * 16, "shadow")
            # The renderer indexes shadow frames with the body's frame index.
            self.assertEqual(atlas["framesInFile"], 30 * 16)
            self.assertTrue(out.is_file())
            with Image.open(out) as image:
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(list(image.size), atlas["size"])

    def test_outline_layer_walks_its_own_command_rows(self):
        # The outline layer is not BC-compressed: each block row is a command
        # stream indexed by its own offset table. The decoder raises unless a
        # row's commands cover exactly its blocks and consume exactly its
        # bytes, so decoding every frame is the proof that the reading is
        # right — there is no partial credit.
        from sld_layers import decode_colors, decode_outlines
        data = (GRAPHICS / "b_dark_barracks_age1_x1.sld").read_bytes()
        outlines = decode_outlines(data)
        colors = decode_colors(data)
        self.assertTrue(outlines and all(f is not None and not f.empty for f in outlines))
        drawn = inside = opaque = 0
        for outline, color in zip(outlines, colors):
            self.assertEqual((outline.width, outline.height), (color.width, color.height))
            for index in range(outline.width * outline.height):
                lit = bool(outline.alpha[index])
                solid = bool(color.rgba[index * 4 + 3])
                drawn += lit
                opaque += solid
                inside += lit and solid
        # A contour, not a silhouette: it hugs the sprite's edges from inside.
        self.assertGreater(inside / drawn, 0.95)
        self.assertLess(drawn / opaque, 0.3)

    def test_outline_atlas_is_a_tintable_contour(self):
        from convert_sld import convert_mask
        animation = self.result["entities"]["militia"]["animations"]["idle"]
        expected = animation["frames"] * animation["directions"]
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "idle-outline.png"
            atlas = convert_mask(GRAPHICS / animation["source"], out, expected, "outline")
            self.assertTrue(atlas)
            # The renderer indexes the contour with the body's frame index, so
            # the sheet holds an entry for every frame the animation plays.
            self.assertEqual(atlas["framesInFile"], expected)
            with Image.open(out) as image:
                pixels = list(image.convert("RGBA").getdata())  # noqa: PIL deprecation is fine on the pinned version
            lit = [p for p in pixels if p[3] > 0]
            self.assertTrue(lit)
            # Neutral white and fully opaque: the renderer multiplies the DAT's
            # outline colour through it, and a contour has no coverage ramp.
            for red, green, blue, alpha in lit:
                self.assertEqual((red, green, blue, alpha), (255, 255, 255, 255))

    def test_every_death_resolves_what_it_leaves_behind(self):
        # The DAT models a corpse or a stump as its own unit, reached through
        # `dead_unit_id`; the decay art is that unit's standing graphic.
        entities = self.result["entities"]
        militia = entities["militia"]["animations"]["decay"]
        self.assertEqual(militia["source"], "u_inf_militia_decayA_x1.sld")
        self.assertEqual(militia["frames"], 30)
        self.assertEqual(militia["directions"], 16)
        # A depleted tree leaves the generic stump, one frame per variation.
        # The bush names the same unit and never reaches it — see
        # test_only_something_that_can_die_leaves_anything_behind.
        stump = entities["tree-oak"]["animations"]["decay"]
        self.assertEqual(stump["source"], "n_tree_stump_generic_x1.sld")
        self.assertEqual(stump["frames"], 1)
        # The chain is per task variant, not one corpse for every villager.
        self.assertEqual(
            entities["villager-lumberjack"]["animations"]["decay"]["source"],
            "u_vil_male_lumberjack_decayA_x1.sld",
        )
        # A unit with nothing to leave behind must say so rather than resolve
        # to graphic -1 and fail later, mid-conversion.
        from import_content import resolve_graphic_id
        units = _dat().civs[SPEC["civIndex"]].units
        with self.assertRaises(ValueError):
            resolve_graphic_id(units[504], {"slot": "dead"}, units)  # the arrow

    def test_ages_and_technologies_come_from_what_gates_them(self):
        # The DAT's tech names are a age behind: tech 101 is called "Middle
        # Age" and its effect is "Feudal Age". The effect name is the identity,
        # the same way a graphic's file name is a unit's.
        techs = self.result["technologies"]
        feudal = techs["feudal-age"]
        self.assertEqual(feudal["techId"], 101)
        self.assertEqual(feudal["name"], "Feudal Age")
        self.assertEqual(feudal["cost"], {"food": 500})
        self.assertEqual(feudal["researchSeconds"], 130)
        self.assertEqual(feudal["researchedAt"], 109)
        self.assertEqual(feudal["grantsAge"], 1)

        loom = techs["loom"]
        self.assertEqual(loom["cost"], {"gold": 50})
        self.assertEqual(loom["researchSeconds"], 25)
        # Read off the effect commands, not transcribed: +15 hit points, +1
        # melee armour, +2 pierce. The DAT addresses all three to unit class 4
        # rather than to the villager, so every villager task variant gets
        # them -- which is what the class import is for.
        loom_effects = {
            (e["unit"], e["attribute"], e.get("armorClass")): (e["operation"], e["amount"])
            for e in loom["effects"]
        }
        # ...and a skin gets nothing of its own: what lands on the villager
        # lands on the woman wearing his rules (issue #50).
        variants = [key for key, entity in self.result["entities"].items()
                    if entity.get("class") == 4 and "skinOf" not in entity]
        self.assertIn("villager", variants)
        self.assertGreater(len(variants), 1)
        for variant in variants:
            self.assertEqual(loom_effects[(variant, "hitPoints", None)], ("add", 15.0), variant)
            self.assertEqual(loom_effects[(variant, "armor", 4)], ("add", 1), variant)
            self.assertEqual(loom_effects[(variant, "armor", 3)], ("add", 2), variant)

        # Which age a thing belongs to is read from the tech that turns it on.
        ages = {key: entity.get("age") for key, entity in self.result["entities"].items()}
        for key in ("militia", "villager", "barracks", "house", "mill", "outpost"):
            self.assertEqual(ages[key], 0, key)
        for key in ("market", "blacksmith", "archery-range", "stable", "watch-tower",
                    "archer", "skirmisher", "spearman", "scout-cavalry", "trade-cart"):
            self.assertEqual(ages[key], 1, key)
        for key in ("monastery", "siege-workshop", "castle",
                    "knight", "cavalry-archer", "longbowman", "mangonel", "monk"):
            self.assertEqual(ages[key], 2, key)
        # The ram has no enabling tech of its own: the siege workshop it is
        # trained at is what puts it in the Castle Age.
        self.assertEqual(ages["battering-ram"], 0)
        self.assertEqual(self.result["entities"]["battering-ram"]["train"]["buildingId"], 49)

    def test_castle_age_carries_its_price_and_what_it_opens(self):
        castle_age = self.result["technologies"]["castle-age"]
        self.assertEqual(castle_age["techId"], 102)
        self.assertEqual(castle_age["name"], "Castle Age")
        self.assertEqual(castle_age["cost"], {"food": 800, "gold": 200})
        self.assertEqual(castle_age["researchSeconds"], 160)
        self.assertEqual(castle_age["researchedAt"], 109)
        self.assertEqual(castle_age["requiresAge"], 1)
        self.assertEqual(castle_age["grantsAge"], 2)

        entities = self.result["entities"]
        # The castle is the British unique unit's home, and holds people.
        self.assertEqual(entities["castle"]["cost"], {"stone": 650, "wood": 0})
        self.assertEqual(entities["castle"]["popSupport"], 20)
        self.assertEqual(entities["longbowman"]["train"]["buildingId"], entities["castle"]["id"])
        # A monk's two works, as the DAT states them rather than as we guess.
        self.assertEqual(entities["monk"]["heal"], {"hitPointsPerSecond": 1.25, "range": 0.0})
        self.assertEqual(
            entities["monk"]["convert"], {"minSeconds": 5.0, "maxSeconds": 9.0, "range": 9.0}
        )
        # A monk carries no attack at all, which is what keeps it out of the
        # units that pick their own fights. It does carry armour, which is why
        # asking whether the whole `combat` block is absent stopped being the
        # same question (issue #26).
        self.assertEqual(entities["monk"]["combat"]["attacks"], [])
        # The mangonel's stone lands with a blast; an archer's arrow does not.
        self.assertEqual(entities["mangonel"]["combat"]["blastRadius"], 1.0)
        self.assertNotIn("blastRadius", entities["archer"]["combat"])

    def test_skirmisher_is_identified_by_its_art_not_its_name(self):
        # The DAT calls unit 7 "XBOWM" and unit 24 "CARCH": AoK names that never
        # moved with the ids. The graphics say which is which.
        skirmisher = self.result["entities"]["skirmisher"]
        self.assertEqual(skirmisher["id"], 7)
        self.assertEqual(skirmisher["internalName"], "XBOWM")
        for state, source in (("idle", "u_arc_skirmisher_idleA_x1.sld"),
                              ("attack", "u_arc_skirmisher_attackA_x1.sld")):
            self.assertEqual(skirmisher["animations"][state]["source"], source)
        self.assertEqual(skirmisher["cost"], {"food": 25, "wood": 35})
        self.assertEqual(skirmisher["train"], {"buildingId": 87, "seconds": 26, "button": 2})
        # Minimum range is what makes it a skirmisher rather than a small archer.
        self.assertEqual(skirmisher["combat"]["minimumRange"], 1.0)
        self.assertEqual(skirmisher["combat"]["maximumRange"], 4.0)

    def test_stable_and_its_scout_resolve_including_the_sld_that_crashed_openage(self):
        entities = self.result["entities"]
        stable = entities["stable"]
        self.assertEqual(stable["id"], 101)
        self.assertEqual(stable["cost"], {"wood": 175})
        self.assertEqual(stable["build"]["seconds"], 50)
        # The file the previously used decoder died on, now just another source.
        self.assertEqual(stable["animations"]["idle"]["source"], "b_west_stable_age2_x1.sld")
        scout = entities["scout-cavalry"]
        self.assertEqual(scout["id"], 448)
        self.assertEqual(scout["cost"], {"food": 80})
        self.assertEqual(scout["train"], {"buildingId": stable["id"], "seconds": 30, "button": 1})
        self.assertEqual(scout["animations"]["idle"]["source"], "u_cav_scout_idleA_x1.sld")

    def test_gate_leaves_and_axes_come_from_the_dat_units_that_hold_them(self):
        entities = self.result["entities"]
        along_x = entities["palisade-gate"]
        along_y = entities["palisade-gate-y"]
        self.assertEqual((along_x["id"], along_y["id"]), (789, 793))
        # The two are one gate turned: identical numbers, mirrored collision
        # boxes. Two tiles by one is the DAT's, not a guess.
        for gate in (along_x, along_y):
            self.assertEqual(gate["hitPoints"], 240)
            self.assertEqual(gate["cost"], {"wood": 30})
            self.assertEqual(gate["build"]["seconds"], 30)
        self.assertEqual(along_x["collision"], [1.0, 0.5])
        self.assertEqual(along_y["collision"], [0.5, 1.0])
        # Open and closed are separate units in the DAT sharing everything but
        # the art, so the open leaf is read from the unit that holds it.
        self.assertEqual(
            along_x["animations"]["idle"]["source"], "b_dark_gate_palisade_ne_closed_x1.sld"
        )
        self.assertEqual(
            along_x["animations"]["open"]["source"], "b_dark_gate_palisade_ne_open_x1.sld"
        )
        self.assertEqual(
            along_y["animations"]["idle"]["source"], "b_dark_gate_palisade_se_closed_x1.sld"
        )
        self.assertEqual(
            along_y["animations"]["open"]["source"], "b_dark_gate_palisade_se_open_x1.sld"
        )

    def test_selection_markers_carry_the_dat_obstruction_shape_and_outline_box(self):
        entities = self.result["entities"]
        # Units select with the round outline (obstruction type 5); buildings
        # and resources mark their outline box on the ground instead.
        self.assertEqual(entities["villager"]["selection"]["shape"], "round")
        self.assertEqual(entities["villager"]["selection"]["outline"], [0.2, 0.2])
        self.assertEqual(entities["tree-oak"]["selection"]["shape"], "square")
        barracks = entities["barracks"]["selection"]
        self.assertEqual(barracks["shape"], "square")
        # The outline box exceeds the collision box — 1.6 half-tiles drawn
        # around a building that collides at 1.5 — so it is its own field.
        self.assertEqual(barracks["outline"], [1.6, 1.6])
        # A gate outlines its whole four-tile run, not its two collision
        # tiles, and the turned gate unit carries the swapped box.
        self.assertEqual(entities["palisade-gate"]["selection"]["outline"], [2.0, 0.5])
        self.assertEqual(entities["palisade-gate-y"]["selection"]["outline"], [0.5, 2.0])

    def test_trade_cart_carries_its_own_route_rules(self):
        cart = self.result["entities"]["trade-cart"]
        self.assertEqual(cart["id"], 128)
        self.assertEqual(cart["cost"], {"wood": 100, "gold": 50})
        self.assertEqual(cart["train"], {"buildingId": 84, "seconds": 51, "button": 1})
        # The route's economics come from the unit, not from a constant: its
        # work rate is what the road pays per second and its capacity the cap.
        self.assertEqual(cart["trade"], {
            "ratePerSecond": 0.2875, "capacity": 100, "buildingId": 84,
        })
        # A laden cart has its own art, named by the trade task itself.
        self.assertEqual(cart["animations"]["carry"]["source"], "u_trade_cart_west_walkA_x1.sld")
        # No attack of its own, though it has armour like anything else that
        # can be shot at.
        self.assertEqual(cart["combat"]["attacks"], [])

    def test_the_technology_list_is_the_civilisation_tree(self):
        # Which technologies exist is read from the civilisation's own tree and
        # the effect commands behind each one, not transcribed. Three were
        # hand-written before this; the Britons' tree carries the blacksmith
        # lines, the economy technologies and the ages.
        techs = self.result["technologies"]
        self.assertGreater(len(techs), 30)
        for key in ("loom", "feudal-age", "castle-age", "imperial-age", "forging",
                    "fletching", "scale-mail-armor", "wheelbarrow", "double-bit-axe"):
            self.assertIn(key, techs)

        # Forging is "+1 against armour class 4" to the melee classes, which is
        # how the DAT states it -- not "+1 attack".
        forging = {(e["unit"], e["attribute"], e["operation"], e.get("armorClass")): e["amount"]
                   for e in techs["forging"]["effects"]}
        for unit in ("militia", "spearman", "knight", "scout-cavalry"):
            self.assertEqual(forging[(unit, "attack", "add", 4)], 1, unit)

        # Fletching reaches the archers by class, and gives range as well.
        fletching = {(e["unit"], e["attribute"]) for e in techs["fletching"]["effects"]}
        for unit in ("archer", "skirmisher", "longbowman", "cavalry-archer"):
            self.assertIn((unit, "attack"), fletching, unit)
            self.assertIn((unit, "range"), fletching, unit)

        # Every chain the DAT states, in order.
        for key, first in (("iron-casting", "forging"), ("blast-furnace", "iron-casting"),
                           ("bodkin-arrow", "fletching"), ("bracer", "bodkin-arrow"),
                           ("hand-cart", "wheelbarrow"), ("chain-mail-armor", "scale-mail-armor")):
            self.assertIn(first, techs[key].get("requires", []), key)
        # ...and the first of a chain has none.
        self.assertNotIn("requires", techs["forging"])

        # Ballistics is the reason the university is built at all: one `set`
        # of the projectile's smart_mode, and nothing else.
        ballistics = techs["ballistics"]
        self.assertEqual(ballistics["researchedAt"], 209)
        self.assertEqual(ballistics["cost"], {"wood": 300, "gold": 175})
        self.assertEqual(ballistics["effects"], [{
            "unit": "arrow", "attribute": "leadsTarget", "operation": "set", "amount": 1.0,
        }])

        # A multiply on attack packs the armour class the same way an add
        # does, and its low byte is a percentage: Heated Shot arrives as 4321,
        # which is class 16 at x2.25, and Siege Engineers as 2936, class 11 at
        # x1.2. Read as a plain number those are nonsense multipliers.
        heated = [e for e in techs["heated-shot"]["effects"] if e["operation"] == "multiply"]
        self.assertTrue(heated)
        self.assertEqual(heated[0]["amount"], 2.25)
        self.assertEqual(heated[0]["armorClass"], 16)

        # What was left out says why, and Thumb Ring is left out for the
        # reason the civilisation tree gives rather than for a missing entity.
        skipped = {row["name"]: row["reason"] for row in self.result["skippedTechnologies"]}
        self.assertIn("Thumb Ring", skipped)
        self.assertIn("do not have it", skipped["Thumb Ring"])
        self.assertNotIn("Ballistics", skipped)
        # The dock is not imported, so its technologies are not offered.
        self.assertIn("not imported", skipped["Fishing Lines"])
        for reason in skipped.values():
            self.assertTrue(reason)

    def test_a_unit_upgrade_is_a_technology_that_replaces_a_unit(self):
        # The tree states these as `UnitUpgrade` nodes rather than `Research`,
        # and names the technology that performs one separately from the unit
        # it produces. The DAT then states the swap as an `upgrade unit`
        # command -- the same command the ages use on buildings.
        techs = self.result["technologies"]
        maa = techs["man-at-arms"]
        self.assertEqual(maa["techId"], 222)
        self.assertEqual(maa["researchedAt"], 12)
        self.assertEqual(maa["requiresAge"], 1)
        self.assertEqual(maa["cost"], {"food": 100, "gold": 40})
        self.assertEqual(maa["upgrades"], [{"from": "militia", "to": "man-at-arms"}])

        # And it really is a better unit, or the upgrade would be a tax.
        militia = self.result["entities"]["militia"]
        upgraded = self.result["entities"]["man-at-arms"]
        self.assertGreater(upgraded["hitPoints"], militia["hitPoints"])
        melee = {a["class"]: a["amount"] for a in upgraded["combat"]["attacks"]}
        was = {a["class"]: a["amount"] for a in militia["combat"]["attacks"]}
        self.assertGreater(melee[4], was[4])

        # The whole infantry chain is here, and the champion promotes every
        # rung of it at once -- which is what the DAT says: if you still own a
        # militia when Champion lands, it becomes a champion too.
        chain = {"long-swordsman": "man-at-arms", "two-handed-swordsman": "long-swordsman",
                 "champion": "two-handed-swordsman"}
        for key, first in chain.items():
            self.assertIn(first, techs[key]["requires"], key)
        promoted = {u["from"] for u in techs["champion"]["upgrades"]}
        self.assertEqual(promoted, {"militia", "man-at-arms", "long-swordsman",
                                    "two-handed-swordsman"})

        # A civilisation's unique unit takes the same shape, and is not a
        # `UnitUpgrade` node at all: the Elite Longbowman is a `UniqueUnit`
        # carrying a trigger tech, where the plain Longbowman carries none.
        self.assertEqual(techs["elite-longbowman"]["upgrades"],
                         [{"from": "longbowman", "to": "elite-longbowman"}])

        # The upgrades whose far end is not imported say so rather than
        # vanishing: the heavy scorpion needs a unit this game does not have.
        skipped = {row["name"]: row["reason"] for row in self.result["skippedTechnologies"]}
        self.assertIn("Heavy Scorpion", skipped)
        self.assertIn("not imported", skipped["Heavy Scorpion"])

    def test_the_civilisation_is_read_from_its_own_tech_tree(self):
        # An AoE2 civilisation is mostly what it does not get, and the depot
        # ships that per civilisation next to the DAT. Nothing here lists a
        # missing technology by hand: the tree marks them `NotAvailable`.
        civ = self.result["civilization"]
        self.assertEqual(civ["key"], "britons")
        self.assertEqual(civ["datIndex"], SPEC["civIndex"])
        # The DAT calls civ 1 "British"; everything since calls them Britons.
        self.assertEqual(civ["name"], "British")
        self.assertEqual(_dat().civs[SPEC["civIndex"]].name, civ["name"])

        tree = json.loads(
            (DAT.parent / "CivTechTrees" / civ["treeFile"]).read_text()
        )
        nodes = tree["civ_techs_buildings"] + tree["civ_techs_units"]
        by_use = {"Tech": "technologies", "Unit": "units", "Building": "buildings"}
        for node in nodes:
            bucket = by_use.get(node["Use Type"])
            if bucket is None:
                continue
            listed = int(node["Node ID"]) in civ["unavailable"][bucket]
            self.assertEqual(
                listed, node["Node Status"] == "NotAvailable",
                f"{node['Name']} ({bucket} {node['Node ID']})",
            )

        # The ones everybody knows the Britons do without. Thumb Ring is 437;
        # if this ever comes back empty the tree file stopped being read.
        self.assertIn(437, civ["unavailable"]["technologies"])
        self.assertTrue(civ["unavailable"]["units"])

    def test_the_published_manifest_carries_the_technologies(self):
        # The atlas step assembles the manifest the game actually loads, and
        # for a while it left `technologies` out of that dict entirely -- so
        # `rulesFromManifest` found no key and every match ran on the
        # hand-written fallback rules. It failed silently because those
        # numbers agree with the DAT's.
        manifest = Path("public/imported/aoe2/manifest.json")
        if not manifest.is_file():
            self.skipTest("no published manifest to check")
        published = json.loads(manifest.read_text())
        self.assertIn("technologies", published)
        for key, tech in self.result["technologies"].items():
            self.assertIn(key, published["technologies"])
            self.assertEqual(published["technologies"][key], tech)
        # ...and it happened again with `playerAttributes` (issue #23's farm
        # food), which the game read off the fallback's identical 175 for a
        # month. Every key the game reads rules from, not only the one that
        # bit first.
        for key in ("playerAttributes", "civilization", "ages", "playerColors"):
            self.assertIn(key, published, key)
            self.assertEqual(published[key], self.result[key], key)

    def test_every_atlas_fits_a_webgpu_texture(self):
        # A sheet over the device's maxTextureDimension2D (8192 by default)
        # fails silently: no error anywhere, the sprite just renders as a
        # solid box. The unpacked trebuchet's 1920-frame attack packed square
        # was 9116px wide and did exactly that (issue #30).
        manifest = Path("public/imported/aoe2/manifest.json")
        if not manifest.is_file():
            self.skipTest("no published manifest to check")
        published = json.loads(manifest.read_text())
        for key, entity in published["entities"].items():
            for name, atlas in entity.get("atlases", {}).items():
                width, height = atlas["size"]
                self.assertLessEqual(
                    max(width, height), 8192,
                    f"{key}/{name} is {width}x{height}, over the 8192 device limit",
                )

    def test_a_line_keeps_its_cell_in_the_grid(self):
        # The DAT places every train and research button (`button_id`, 1-15),
        # and a line shares its cell: that is what keeps a button where the
        # hand expects it when a technology lands. Assert the rule on every
        # upgrade line the tree carries, and the three cells everyone knows.
        entities = self.result["entities"]
        technologies = self.result["technologies"]
        for tech in technologies.values():
            for step in tech.get("upgrades", []):
                self.assertEqual(entities[step["from"]]["train"]["button"],
                                 entities[step["to"]]["train"]["button"], step)
        self.assertEqual(entities["militia"]["train"]["button"], 1)
        self.assertEqual(entities["spearman"]["train"]["button"], 2)
        self.assertEqual(technologies["loom"]["button"], 6)
        self.assertEqual({technologies[k]["button"] for k in ("feudal-age", "castle-age", "imperial-age")}, {11})
        self.assertEqual({technologies[k]["button"] for k in ("forging", "iron-casting", "blast-furnace")}, {1})
        for key, tech in technologies.items():
            self.assertIn("button", tech, key)
            self.assertTrue(1 <= tech["button"] <= 15, key)
        # Task variants and the set-up trebuchet are never on a button, and the
        # DAT gives them cell 0; everything a player actually trains has one.
        for key, entity in entities.items():
            if entity.get("category") == "unit" and "train" in entity and "skinOf" not in entity \
                    and key != "trebuchet-unpacked":
                self.assertTrue(1 <= entity["train"]["button"] <= 15, key)

    def test_a_skin_is_the_same_unit_in_other_clothes(self):
        # Issue #50: the female villager is DAT unit 293 beside the male 83,
        # and each task unit has its counterpart. The rule: a skin carries
        # exactly its base's numbers and tasks, differs in art and voice, and
        # takes the odds `objreplacement.json` states -- on the base only.
        entities = self.result["entities"]
        dat = _dat()
        civ = dat.civs[SPEC["civIndex"]]
        skins = {key: e for key, e in entities.items() if "skinOf" in e}
        self.assertEqual(len(skins), 9)
        for key, skin in skins.items():
            base = entities[skin["skinOf"]]
            self.assertEqual(skin["skin"], "female", key)
            self.assertEqual(skin.get("category"), base.get("category"), key)
            for field in ("hitPoints", "lineOfSight", "collision", "speedTilesPerSecond",
                          "gather", "class", "cost", "populationCost", "dropSites"):
                self.assertEqual(skin.get(field), base.get(field), f"{key}.{field}")
            # Combat too, less the two numbers that belong to the art: the
            # hunter's bow leaves her hands at frame 15 and 1.2 tiles up where
            # his is frame 10 and 1.5 -- her own sheets, her own timing. The
            # simulation reads the base's, so a skin never changes a shot.
            art_timing = {"frameDelay", "launchOffset"}
            self.assertEqual(
                {k: v for k, v in (skin.get("combat") or {}).items() if k not in art_timing},
                {k: v for k, v in (base.get("combat") or {}).items() if k not in art_timing}, key)
            mine, theirs = civ.units[skin["id"]], civ.units[base["id"]]
            self.assertEqual(
                sorted((t.action_type, t.class_id, t.unit_id) for t in mine.bird.tasks),
                sorted((t.action_type, t.class_id, t.unit_id) for t in theirs.bird.tasks), key)
            self.assertEqual(sorted(skin["animations"]), sorted(base["animations"]), key)
            for name in skin["animations"]:
                self.assertNotEqual(skin["animations"][name]["source"], base["animations"][name]["source"],
                                    f"{key}.{name} draws the base's art")
                self.assertIn("female", skin["animations"][name]["source"], f"{key}.{name}")
        # The odds, from the file, on the base unit's skin and nowhere else.
        self.assertEqual(skins["villager-female"]["chance"], 50)
        self.assertEqual([k for k, e in skins.items() if "chance" in e], ["villager-female"])
        self.assertIn("objreplacement.json", self.result["source"]["sha256"])
        # Her own voice, and the town center's one cue for a villager made.
        self.assertNotEqual(skins["villager-female"]["sounds"]["select"], entities["villager"]["sounds"]["select"])
        self.assertEqual(skins["villager-female"]["sounds"]["train"], entities["villager"]["sounds"]["train"])
        # Nothing on the simulation's side: no technology addresses a skin.
        for key, tech in self.result["technologies"].items():
            for effect in tech.get("effects", []):
                self.assertNotIn(effect.get("unit"), skins, f"{key} reaches {effect.get('unit')}")

    def test_a_building_names_its_fires_and_the_particles_they_are(self):
        # Issue #73: `damage_graphics` are, per threshold of hit points lost,
        # a composite whose deltas are the reference's fire particles at
        # their places on the picture. The Dark Age house lights four small
        # fires past 25 percent, and the Feudal house -- another picture --
        # has its own places for them.
        entities = self.result["entities"]
        house = entities["house"]["damageStages"]
        self.assertEqual([stage["percent"] for stage in house["idle"]], [25, 50, 75])
        self.assertEqual(len(house["idle"][0]["flames"]), 4)
        self.assertEqual(house["idle"][0]["flames"][0], {"effect": "fire_small_left", "offset": [-27, 15]})
        self.assertEqual({f["effect"] for f in house["idle"][2]["flames"]},
                         {"fire_large_left", "fire_medium_right", "fire_small_left"})
        self.assertIn("idle-feudal", house)
        self.assertNotEqual(house["idle-feudal"], house["idle"])
        # A building whose Feudal picture is its Dark Age one has one list.
        self.assertEqual(list(entities["lumber-camp"]["damageStages"]), ["idle"])
        for key, entity in entities.items():
            if entity["category"] == "building" and key != "farm":
                self.assertIn("damageStages", entity, key)
        # The particles: six flipbooks of sixty frames from the fire atlas,
        # at half scale, the right-handed ones mirrored, cycling about three
        # seconds and fading in over three quarters of one.
        particles = self.result["particles"]
        self.assertEqual(sorted(particles), [
            "fire_large_left", "fire_large_right", "fire_medium_left",
            "fire_medium_right", "fire_small_left", "fire_small_right",
        ])
        for name, effect in particles.items():
            self.assertEqual(len(effect["frames"]), 60, name)
            self.assertEqual(effect["scale"], 0.5, name)
            self.assertEqual(effect["flipHorizontal"], name.endswith("_right"), name)
            self.assertTrue(effect["loop"], name)
            self.assertEqual(effect["fadeInSeconds"], 0.75, name)
        self.assertEqual(particles["fire_small_left"]["cycleSeconds"], [2.9, 3.1])
        self.assertEqual(particles["fire_small_left"]["frames"],
                         particles["fire_small_right"]["frames"])
        self.assertIn("particles/textures/atlases/fire.png", self.result["source"]["sha256"])

    def test_the_published_manifest_carries_the_fires_and_the_soot(self):
        # The converter cuts each flipbook into an atlas of its own, upright
        # and at scale, and packs a building's SLD damage layer as a fourth
        # mask over its standing art.
        manifest = Path("public/imported/aoe2/manifest.json")
        if not manifest.is_file():
            self.skipTest("no published manifest to check")
        published = json.loads(manifest.read_text())
        if "particles" not in published:
            self.skipTest("published manifest predates the fires")
        for name in self.result["particles"]:
            effect = published["particles"][name]
            atlas = effect["atlas"]
            self.assertEqual(atlas["framesInFile"], 60, name)
            self.assertEqual(len(atlas["frames"]), 60, name)
            self.assertTrue((manifest.parent / atlas["image"]).is_file(), name)
            # Half scale of a 512 canvas: nothing taller than 256.
            for frame in atlas["frames"]:
                self.assertLessEqual(frame["h"], 256, name)
                self.assertLessEqual(frame["w"], 256, name)
                self.assertGreater(frame["w"], 0, name)
            self.assertEqual(effect["cycleSeconds"], self.result["particles"][name]["cycleSeconds"])
        house = published["entities"]["house"]["atlases"]
        self.assertIn("idle-damage", house)
        self.assertIn("idle-feudal-damage", house)
        self.assertNotIn("death-damage", house)
        self.assertNotIn("idle-damage", published["entities"]["villager"]["atlases"])
        with Image.open(manifest.parent / house["idle-damage"]["image"]) as sheet:
            self.assertEqual(sheet.getchannel("R").getextrema(), (255, 255))
            self.assertGreater(sheet.getchannel("A").getextrema()[1], 200)

    def test_a_farm_is_sown_and_worked_in_the_farmer_s_own_art(self):
        # Issue #71: the build task (action 101) carries two graphics, and
        # the DAT names them -- `proceeding` is the builder's hammer and
        # `working` is the farmer's seed-sowing, so a farm going up is sown.
        # The farmer is a task unit of its own (259, task unit 50; 214 for
        # her) with its own scythe, rate and carry.
        entities = self.result["entities"]
        builder = entities["villager-builder"]["animations"]
        self.assertEqual(builder["work"]["source"], "u_vil_male_builder_taskA_x1.sld")
        self.assertEqual(builder["work-farm"]["source"], "u_vil_male_farmer_seedA_x1.sld")
        self.assertEqual(entities["villager-female-builder"]["animations"]["work-farm"]["source"],
                         "u_vil_female_farmer_seedA_x1.sld")
        farmer = entities["villager-farmer"]
        self.assertEqual(farmer["id"], 259)
        self.assertEqual(farmer["animations"]["work"]["source"], "u_vil_male_farmer_taskA_x1.sld")
        self.assertEqual(farmer["animations"]["carry"]["source"], "u_vil_male_farmer_carrywalkA_x1.sld")
        self.assertEqual(farmer["gather"], {"resource": "food", "ratePerSecond": 0.53, "capacity": 10,
                                            "task": {"actionType": 5, "unitId": 50}})
        self.assertEqual(entities["villager-female-farmer"]["skinOf"], "villager-farmer")
        self.assertEqual(entities["villager-female-farmer"]["id"], 214)

    def test_the_refusal_lines_are_the_reference_s_own(self):
        # Issue #70: the reference lets an unaffordable press through and
        # says why, in its own words -- strings 3001-3005.
        self.assertEqual(self.result["strings"], {
            "notEnoughFood": "Not enough food.",
            "notEnoughWood": "Not enough wood.",
            "notEnoughStone": "Not enough stone.",
            "notEnoughGold": "Not enough gold.",
            "needMoreHouses": "You need to build more houses.",
        })

    def test_names_and_tooltips_are_the_reference_strings(self):
        # Issue #48: what the panel calls a thing is the DAT's own string,
        # not the slug spelled out. The rows are the ones the slug got wrong.
        entities = self.result["entities"]
        self.assertEqual(entities["man-at-arms"]["text"]["name"], "Man-at-Arms")
        self.assertEqual(entities["two-handed-swordsman"]["text"]["name"], "Two-Handed Swordsman")
        self.assertEqual(entities["villager-goldminer"]["text"]["name"], "Gold Miner")
        self.assertEqual(entities["villager-stonemason"]["text"]["name"], "Stone Miner")
        self.assertEqual(entities["villager-lumberjack"]["text"]["name"], "Lumberjack")
        self.assertEqual(entities["villager"]["text"]["name"], "Villager (Male)")
        self.assertEqual(entities["villager"]["text"]["create"], "Create Villager")
        self.assertEqual(entities["town-center"]["text"]["create"], "Build Town Center")
        self.assertTrue(entities["villager"]["text"]["help"].startswith("Create <b>Villager<b> (<cost>)"))
        # Everything with a unit behind it has a name; what a player creates
        # has the button text and the tooltip too. The gate's directional
        # leaves carry no help of their own (the buildable gate, DAT unit 792,
        # does), and gaia's animals carry none. Flight art and the flag have
        # no strings at all and get none rather than somebody else's.
        for key, entity in entities.items():
            if entity.get("category") in ("projectile", "effect") or "id" not in entity:
                self.assertNotIn("text", entity, key)
                continue
            self.assertIn("name", entity["text"], key)
            if entity.get("category") in ("unit", "unit-variant", "building") and not key.startswith("palisade-gate"):
                self.assertEqual(sorted(entity["text"]), ["create", "help", "name"], key)
        technologies = self.result["technologies"]
        self.assertEqual(technologies["loom"]["text"]["name"], "Loom")
        self.assertEqual(technologies["loom"]["name"], "Loom")
        self.assertEqual(technologies["man-at-arms"]["name"], "Man-at-Arms")
        self.assertTrue(technologies["loom"]["text"]["help"].startswith("Research <b>Loom<b> (<cost>)"))
        self.assertIn("strings", self.result["source"]["sha256"])

    def test_delete_asks_where_the_dat_flags_it(self):
        # Issue #47: `hero_mode` bit 32 is the safe-delete confirmation, and
        # it is on five buildings -- not on "buildings". A house goes on the
        # keypress as in the reference.
        entities = self.result["entities"]
        flagged = sorted(key for key, entity in entities.items() if entity.get("confirmDelete"))
        self.assertEqual(flagged, ["castle", "monastery", "town-center", "watch-tower", "wonder"])
        dat = _dat()
        civ = dat.civs[SPEC["civIndex"]]
        for entry in SPEC["entities"]:
            if entry.get("civ") == "gaia":
                continue
            unit = civ.units[entry["unitId"]]
            if unit is None or unit.creatable is None:
                continue
            self.assertEqual(bool(unit.creatable.hero_mode & 32),
                             bool(entities[entry["key"]].get("confirmDelete")), entry["key"])

    def test_a_miss_lands_the_dat_dispersion_away(self):
        # Issue #45: the DAT states how far a shot that fails its accuracy
        # roll lands from the aim. Everything that can miss carries it, and
        # nothing that cannot does -- a 0 here would leave a shooter missing
        # onto its own target.
        entities = self.result["entities"]
        for key in ("archer", "crossbowman", "arbalester", "skirmisher", "elite-skirmisher",
                    "cavalry-archer", "heavy-cavalry-archer", "longbowman", "elite-longbowman"):
            self.assertEqual(entities[key]["combat"]["accuracyDispersion"], 0.33, key)
        self.assertEqual(entities["trebuchet-unpacked"]["combat"]["accuracyDispersion"], 0.2)
        self.assertEqual(entities["trebuchet-unpacked"]["combat"]["accuracyPercent"], 15)
        for key in entities:
            combat = entities[key].get("combat")
            if not combat or "accuracyPercent" not in combat:
                continue
            # The packed trebuchet reads 92 with no dispersion, and never
            # shoots: it is the set-up unit's numbers that a shot carries.
            if combat["accuracyPercent"] < 100 and combat["attacks"] and key != "trebuchet":
                self.assertIn("accuracyDispersion", combat, key)
            if combat["accuracyPercent"] >= 100:
                self.assertNotIn("accuracyDispersion", combat, key)

    def test_blast_levels_decide_what_a_stone_reaches(self):
        # Issue #46: a target is caught when its `blast_defense_level` is at
        # least the shooter's `blast_attack_level`. The rows are the rule:
        # mangonel 2 reaches units (3) and buildings (2), onager 1 reaches
        # trees (1) as well, nothing reaches a bush or a mine (0).
        entities = self.result["entities"]
        self.assertEqual(entities["mangonel"]["combat"]["blastAttackLevel"], 2)
        self.assertEqual(entities["onager"]["combat"]["blastAttackLevel"], 1)
        self.assertNotIn("blastAttackLevel", entities["archer"]["combat"])
        for key in ("militia", "villager", "knight", "monk", "sheep", "mangonel"):
            self.assertEqual(entities[key]["blastDefenseLevel"], 3, key)
        for key in ("town-center", "house", "barracks", "palisade-wall", "watch-tower", "castle"):
            self.assertEqual(entities[key]["blastDefenseLevel"], 2, key)
        self.assertEqual(entities["tree-oak"]["blastDefenseLevel"], 1)
        for key in ("berries", "gold", "stone"):
            self.assertEqual(entities[key]["blastDefenseLevel"], 0, key)

    def test_accuracy_and_ballistics_are_attributes_the_dat_states(self):
        # Both halves of how a shot lands are in the DAT and neither was read
        # before (issue #3). Accuracy varies widely enough that a constant
        # would be wrong for almost every shooter.
        entities = self.result["entities"]
        self.assertEqual(entities["archer"]["combat"]["accuracyPercent"], 80)
        self.assertEqual(entities["skirmisher"]["combat"]["accuracyPercent"], 90)
        self.assertEqual(entities["longbowman"]["combat"]["accuracyPercent"], 70)
        self.assertEqual(entities["cavalry-archer"]["combat"]["accuracyPercent"], 50)
        for key in ("watch-tower", "castle", "mangonel", "villager-hunter", "militia"):
            self.assertEqual(entities[key]["combat"]["accuracyPercent"], 100, key)

        # Every projectile ships without the lead, and Ballistics is the
        # effect that turns it on: a `set attribute` on smart_mode (19) for
        # each projectile unit. If that ever ships as 1 the technology would
        # be doing nothing, so assert the starting state.
        self.assertIs(entities["arrow"]["projectile"]["leadsTarget"], False)
        dat = _dat()
        ballistics = dat.effects[dat.techs[93].effect_id]
        self.assertEqual(ballistics.name, "Ballistics")
        commands = [c for c in ballistics.effect_commands if c.type == 0 and int(c.c) == 19]
        self.assertGreater(len(commands), 30)
        # `smart_mode` is a flag field: Ballistics sets the low bit on every
        # projectile, and fourteen of them already carry a second flag and so
        # come out as 3. Reading it as a boolean would drop those fourteen.
        self.assertTrue(all(int(c.d) & 1 for c in commands))
        self.assertEqual({int(c.d) for c in commands}, {1, 3})
        # And it does nothing else at all.
        self.assertEqual(
            {(c.type, int(c.c)) for c in ballistics.effect_commands}, {(0, 19)},
        )

        # ...and Thumb Ring is the one that sets accuracy, by unit class.
        thumb_ring = dat.effects[dat.techs[437].effect_id]
        self.assertEqual(thumb_ring.name, "Thumb Ring")
        accuracy = [c for c in thumb_ring.effect_commands if c.type == 0 and int(c.c) == 11]
        self.assertTrue(accuracy)
        self.assertTrue(all(int(c.a) == -1 and c.d == 100.0 for c in accuracy))

    def test_each_age_brings_the_building_the_dat_upgrades_it_into(self):
        # Ageing up in AoE2 replaces a building rather than restyling it: the
        # Feudal Age technology carries `upgrade unit` commands turning the
        # barracks (12) into "Barracks Age2" (498) and the town center into
        # RTWC2, and each of the town center's four annex pieces separately.
        # The art for each age is read from those commands, so nothing here is
        # a hand-written unit id (issue #13).
        from import_content import age_variants
        dat = _dat()
        entities = self.result["entities"]
        self.assertEqual(age_variants(dat, 12), {"feudal": 498, "castle": 132, "imperial": 20})

        checked = 0
        for key, entity in entities.items():
            if entity["category"] != "building":
                continue
            spec = next(e for e in SPEC["entities"] if e["key"] == key)
            for age in age_variants(dat, spec["unitId"]):
                self.assertIn(f"idle-{age}", entity["animations"], f"{key} {age}")
                checked += 1
        self.assertGreater(checked, 12)

        # The Dark Age barracks is timber and the Feudal one is not the same
        # source file; a variant resolving back to the base art would look
        # like no change at all in a played match.
        barracks = entities["barracks"]["animations"]
        self.assertNotEqual(barracks["idle"]["source"], barracks["idle-feudal"]["source"])
        self.assertNotEqual(barracks["idle-feudal"]["source"], barracks["idle-castle"]["source"])

        # The town center's annexes age with it.
        annex = entities["town-center"]["annexes"][0]["animations"]
        for age in ("feudal", "castle", "imperial"):
            self.assertIn(f"idle-{age}", annex)
        self.assertNotEqual(annex["idle"]["source"], annex["idle-feudal"]["source"])

    def test_each_age_falls_as_itself(self):
        # A razed Feudal house played the Dark Age collapse and left Dark Age
        # rubble (issue #61). The variant unit the age technology upgrades it
        # into has its own `dying_graphic` and names its own rubble unit
        # (`House Age2 (Rubble)`), so both follow the age. Where an age reuses
        # the previous age's sheet -- the Imperial house is the Castle one --
        # nothing is emitted and the renderer's age chain falls back.
        house = self.result["entities"]["house"]["animations"]
        for age in ("feudal", "castle"):
            self.assertIn(f"death-{age}", house)
            self.assertIn(f"decay-{age}", house)
        self.assertNotIn("death-imperial", house)
        self.assertNotIn("decay-imperial", house)
        sources = {house[name]["source"] for name in ("death", "death-feudal", "death-castle")}
        self.assertEqual(len(sources), 3)
        self.assertEqual(house["death-feudal"]["source"], "b_west_house_age2_destruction_x1.sld")
        self.assertEqual(house["decay-feudal"]["source"], "b_west_house_age2_rubble_x1.sld")
        # A collapse is the same length in every age, so the corpse window the
        # simulation keeps from the base art holds for the variants too.
        for name in ("death", "death-feudal", "death-castle"):
            self.assertEqual(house[name]["frames"], house["death"]["frames"])
            self.assertEqual(house[name]["frameSeconds"], house["death"]["frameSeconds"])
        # A building whose Feudal self is its Dark Age self gets no duplicate.
        self.assertNotIn("death-feudal", self.result["entities"]["blacksmith"]["animations"])
        self.assertIn("death-castle", self.result["entities"]["blacksmith"]["animations"])

    def test_only_something_that_can_die_leaves_anything_behind(self):
        # A forage bush names STUMP (415) in `dead_unit_id`, exactly as the oak
        # does, but it has zero hit points and no dying graphic — it cannot
        # die, so the engine never reaches that unit and a worked-out bush
        # leaves nothing (issue #12). Asking for the slot is a spec error.
        entities = self.result["entities"]
        self.assertNotIn("decay", entities["berries"]["animations"])
        self.assertIn("decay", entities["tree-oak"]["animations"])
        dat = _dat()
        for key, entity in entities.items():
            if "decay" not in entity["animations"]:
                continue
            spec = next(e for e in SPEC["entities"] if e["key"] == key)
            civ = 0 if spec.get("civ") == "gaia" else SPEC["civIndex"]
            unit = dat.civs[civ].units[spec["unitId"]]
            self.assertGreaterEqual(unit.dying_graphic, 0, key)

        # And the importer refuses rather than quietly handing over the stump.
        from import_content import resolve_graphic_id
        bush = dat.civs[0].units[59]
        with self.assertRaises(ValueError):
            resolve_graphic_id(bush, {"slot": "dead"}, dat.civs[0].units, dat)

    def test_fog_visibility_separates_what_gaia_placed_from_what_a_player_owns(self):
        # This one field decides whether a thing keeps being drawn once its
        # tile goes dark, and it splits cleanly: everything gaia puts on the
        # map is 1, everything a player trains or builds is 0. A unit left at
        # the wrong value stands frozen in the fog with nothing failing, so
        # the split is asserted rather than trusted.
        entities = self.result["entities"]
        for key in ("berries", "gold", "stone", "tree-oak", "sheep", "deer", "boar"):
            self.assertEqual(entities[key]["fogVisibility"], 1, key)
        for key in ("villager", "militia", "archer", "scout-cavalry",
                    "town-center", "barracks", "house", "castle"):
            self.assertEqual(entities[key]["fogVisibility"], 0, key)

    def test_gather_point_flag_resolves_by_its_own_graphic_name(self):
        # Nothing in the unit table points at the waypoint flag, so it is found
        # by name — and the name has to match exactly one graphic, or the
        # import fails rather than picking a first hit.
        from import_content import effect_entry
        flag = self.result["entities"]["rally-flag"]
        self.assertEqual(flag["category"], "effect")
        idle = flag["animations"]["idle"]
        self.assertEqual(idle["source"], "b_misc_waypoint_flag_britons_x1.sld")
        self.assertEqual(idle["frames"], 90)
        self.assertEqual(idle["directions"], 1)
        self.assertEqual(len(self.result["source"]["sha256"][idle["source"]]), 64)
        with self.assertRaises(ValueError):
            effect_entry(_dat(), GRAPHICS, {"key": "x", "graphic": "no such graphic"}, {})

    def test_every_modelled_unit_matches_the_dat(self):
        """Issue #36: the numbers are the reference's, all of them.

        Read back from the DAT independently of the importer -- hit points,
        line of sight, collision, speed, reload, range, and every attack and
        armour class -- for every unit the spec names. A unit whose stats are
        quietly hand-written instead of imported shows up here as a mismatch.
        """
        from genieutils.datfile import DatFile

        dat = DatFile.parse(str(DAT))
        spec = SPEC
        mismatches = []
        checked = 0
        for entry in spec["entities"]:
            if "unitId" not in entry:
                continue
            ours = self.result["entities"].get(entry["key"])
            civ = dat.civs[spec["gaiaIndex"] if entry.get("civ") == "gaia" else spec["civIndex"]]
            theirs = civ.units[entry["unitId"]]
            if ours is None or theirs is None:
                continue
            rows = [
                ("hitPoints", ours.get("hitPoints"), theirs.hit_points),
                ("lineOfSight", ours.get("lineOfSight"), round(theirs.line_of_sight, 3)),
                ("collision", (ours.get("collision") or [None])[0], round(theirs.collision_size_x, 3)),
            ]
            if ours.get("speedTilesPerSecond") is not None:
                rows.append(("speed", ours["speedTilesPerSecond"], round(theirs.speed, 3)))
            combat = ours.get("combat")
            if combat and theirs.type_50 is not None:
                rows.append(("reload", combat.get("reloadSeconds"), round(theirs.type_50.reload_time, 3)))
                rows.append(("range", combat.get("maximumRange"), round(theirs.type_50.max_range, 3)))
                rows.append(("accuracyDispersion", combat.get("accuracyDispersion", 0),
                             round(theirs.type_50.accuracy_dispersion, 6)))
                if combat.get("blastRadius"):
                    rows.append(("blastAttackLevel", combat.get("blastAttackLevel"),
                                 theirs.type_50.blast_attack_level))
                rows.append((
                    "attacks",
                    sorted((a["class"], a["amount"]) for a in combat.get("attacks") or []),
                    sorted((a.class_, a.amount) for a in (theirs.type_50.attacks or [])),
                ))
                rows.append((
                    "armors",
                    sorted((a["class"], a["amount"]) for a in combat.get("armors") or []),
                    sorted((a.class_, a.amount) for a in (theirs.type_50.armours or [])),
                ))
            rows.append(("blastDefenseLevel", ours.get("blastDefenseLevel"), theirs.blast_defense_level))
            for name, mine, reference in rows:
                checked += 1
                if mine != reference:
                    mismatches.append(f"{entry['key']}.{name}: imported {mine!r}, DAT {reference!r}")
        self.assertEqual(mismatches, [], "\n".join(mismatches))
        # Guard the guard: if the spec ever stops naming units, this passes
        # vacuously and says nothing.
        self.assertGreater(checked, 400, "too few stats checked to mean anything")

    def test_terrain_carries_what_decides_a_blend(self):
        """A blend needs to know which terrain wins and which masks to use."""
        for key in ("ground", "forest", "farm"):
            slot = self.result["terrain"][key]
            self.assertIn("blendPriority", slot, key)
            self.assertIn("blendType", slot, key)
        # The farm is what the reported defect was about: it must out-rank the
        # grass it sits in, or it would be the grass that bled over the farm.
        self.assertGreater(
            self.result["terrain"]["farm"]["blendPriority"],
            self.result["terrain"]["ground"]["blendPriority"],
        )
        # Farms are their own blend family; ordinary ground is land-on-land.
        self.assertEqual(self.result["terrain"]["farm"]["blendType"], 1)
        self.assertEqual(self.result["terrain"]["ground"]["blendType"], 0)

    def test_ground_terrain_comes_from_the_dat(self):
        ground = self.result["terrain"]["ground"]
        # Grass is DAT terrain 0; its texture name and tile span drive the
        # renderer, so neither may be transcribed by hand.
        self.assertEqual(ground["terrainId"], 0)
        self.assertEqual(ground["name"], "Grass")
        self.assertEqual(ground["texture"], "g_grs")
        self.assertEqual(ground["dimensions"], [10, 10])
        self.assertEqual(
            {key: (self.result["terrain"][key]["terrainId"], self.result["terrain"][key]["texture"])
             for key in ("water", "road", "forest")},
            {"water": (1, "g_wtr"), "road": (24, "g_rd1"), "forest": (10, "g_for")},
        )

    def test_terrain_texture_converts_to_a_loadable_png(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            hashes: dict[str, str] = {}
            converted = convert_terrain(self.result["terrain"], TERRAIN, out, hashes)
            image_path = out / converted["ground"]["image"]
            self.assertTrue(image_path.is_file())
            with Image.open(image_path) as image:
                self.assertEqual(image.mode, "RGBA")
                # Square power-of-two tiling texture; seams show otherwise.
                self.assertEqual(image.width, image.height)
            self.assertIn("terrain/g_grs.dds", hashes)

    def test_militia_fixture_keeps_patch_matched_rules(self):
        unit = self.result["entities"]["militia"]
        self.assertEqual(unit["id"], 74)
        self.assertEqual(unit["hitPoints"], 40)
        self.assertEqual(unit["cost"], {"food": 50, "gold": 20})
        self.assertEqual(unit["populationCost"], 1)
        self.assertEqual(unit["train"], {"buildingId": 12, "seconds": 21, "button": 1})
        self.assertIn({"class": 4, "amount": 4}, unit["combat"]["attacks"])
        self.assertIn({"class": 3, "amount": 1}, unit["combat"]["armors"])
        self.assertEqual(unit["combat"]["reloadSeconds"], 2.0)

    def test_economy_entities_carry_dat_backed_rules(self):
        entities = self.result["entities"]
        self.assertEqual(entities["villager"]["train"], {"buildingId": 109, "seconds": 25, "button": 1})
        self.assertEqual(entities["villager-forager"]["gather"]["resource"], "food")
        self.assertEqual(entities["villager-forager"]["gather"]["ratePerSecond"], 0.31)
        self.assertEqual(entities["villager-lumberjack"]["gather"]["resource"], "wood")
        self.assertEqual(entities["villager-goldminer"]["gather"]["resource"], "gold")
        for variant in ("villager-forager", "villager-lumberjack", "villager-goldminer"):
            self.assertEqual(entities[variant]["gather"]["capacity"], 10)
        self.assertEqual(entities["house"]["cost"], {"wood": 25})
        self.assertEqual(entities["house"]["popSupport"], 5)
        self.assertEqual(entities["house"]["build"]["seconds"], 25)
        self.assertEqual(entities["barracks"]["build"]["seconds"], 50)
        self.assertEqual(entities["berries"]["storage"], {"food": 125})
        self.assertEqual(entities["gold"]["storage"], {"gold": 800})
        self.assertEqual(entities["tree-oak"]["storage"], {"wood": 100})
        self.assertEqual(entities["town-center"]["collision"], [2.0, 2.0])
        self.assertTrue(entities["town-center"]["annexes"])

    def test_every_building_carries_armour_whether_or_not_it_fights(self):
        """Issue #26.

        The importer used to ask for a ``combat`` block only when the unit had
        an attack, so the four buildings that shoot carried armours and the
        other fifteen carried none. Damage is scored class by class and a class
        the target has no entry for scores nothing, so a house took the
        minimum -- one point -- from a sword, an arrow and a battering ram
        alike, and no blacksmith upgrade could move it.
        """
        entities = self.result["entities"]
        buildings = [k for k, e in entities.items() if e.get("category") == "building"]
        self.assertGreater(len(buildings), 15)
        for key in buildings:
            with self.subTest(building=key):
                self.assertTrue(entities[key].get("combat", {}).get("armors"))
        # A house is soft to a blade and hard to an arrow, which is the DAT's
        # own answer to why archers do not raze towns.
        house = entities["house"]["combat"]["armors"]
        self.assertIn({"class": 4, "amount": -2}, house)
        self.assertIn({"class": 3, "amount": 7}, house)
        # A building that never fights is still given no attack of its own.
        self.assertEqual(entities["house"]["combat"]["attacks"], [])

    def test_the_mill_technologies_change_a_player_attribute(self):
        """Issue #23.

        Horse Collar and Heavy Plow were recorded as reaching nothing, because
        the importer read only the effect commands that change a *unit*
        attribute (types 0, 4 and 5). Both are really made of type 1, the
        resource modifier, which addresses a player attribute by resource id.
        A farm's food is resource 36, and civ 1 starts it at 175 -- the number
        the open fallback had hand-written.
        """
        self.assertEqual(self.result["playerAttributes"]["farmFoodAmount"], 175.0)
        techs = self.result["technologies"]
        for key, added, age in (("horse-collar", 75.0, 1), ("heavy-plow", 125.0, 2)):
            with self.subTest(tech=key):
                tech = techs[key]
                self.assertEqual(tech["researchedAt"], 68)  # the mill
                self.assertEqual(tech["requiresAge"], age)
                self.assertIn(
                    {"resource": "farmFoodAmount", "operation": "add", "amount": added},
                    tech["effects"],
                )
        # The DAT's own chain, and the DAT's own refusal: the Britons have no
        # Crop Rotation, so it stays skipped for that reason and not this one.
        self.assertIn("horse-collar", techs["heavy-plow"]["requires"])
        self.assertNotIn("crop-rotation", techs)
        # A technology that lands something still says what it did not: the +1
        # carry for the farmer villagers has no farmer variant to land on.
        self.assertIn("attribute 14 on unit 214", techs["heavy-plow"]["unmodelled"])

    def test_every_animation_resolves_to_hashed_source(self):
        hashes = self.result["source"]["sha256"]
        for key, entity in self.result["entities"].items():
            groups = [entity["animations"]] + [
                annex["animations"] for annex in entity.get("annexes", [])
            ]
            for animations in groups:
                for state, animation in animations.items():
                    self.assertGreater(animation["frames"], 0, f"{key}/{state}")
                    self.assertEqual(len(hashes[animation["source"]]), 64, f"{key}/{state}")

    def test_player_colour_ramps_come_from_the_dat_palette_blocks(self):
        from import_content import read_jasc_pal
        colors = self.result["playerColors"]
        players = colors["players"]
        self.assertEqual(len(players), 8)
        blue, red, grey = players["1"], players["2"], players["7"]
        # The DAT's own player_colours order is what puts blue first and red
        # second, and its colour base is where each block starts.
        self.assertEqual(blue["minimapColor"], [0, 0, 255])
        self.assertEqual(red["minimapColor"], [255, 0, 0])
        self.assertEqual(blue["colorBase"], 16)
        self.assertEqual(red["colorBase"], 32)
        # The DAT names the contour colour too, so it is never picked by eye.
        self.assertEqual(blue["outlineColor"], [0, 0, 255])
        self.assertEqual(red["outlineColor"], [255, 0, 0])
        palette = read_jasc_pal(PALETTES / "original.pal")
        self.assertEqual(blue["ramp"], [list(c) for c in palette[16:24]])
        self.assertEqual(blue["ramp"][0], [0, 0, 82])
        self.assertEqual(blue["ramp"][-1], [205, 250, 255])
        # The grey player's block is the shade axis: neutral and rising, so a
        # sprite's own grey resolves to a position in every other block.
        self.assertEqual([shade[0] for shade in grey["ramp"]], colors["shadeLevels"])
        for shade in grey["ramp"]:
            self.assertEqual(len(set(shade)), 1)
        self.assertEqual(colors["shadeLevels"], sorted(set(colors["shadeLevels"])))
        self.assertEqual(len(self.result["source"]["sha256"]["palettes/original.pal"]), 64)

    def test_regeneration_is_deterministic(self):
        again = extract(DAT, GRAPHICS, PALETTES, SPEC, json.loads(SOURCE.read_text()), STRINGS)
        self.assertEqual(
            json.dumps(self.result, sort_keys=True), json.dumps(again, sort_keys=True)
        )

    def test_decodes_the_sld_whose_outline_layer_crashed_openage(self):
        # b_west_stable_age2_x1.sld reaches its outline branch before any
        # graphics header and crashed the previously used decoder, which is
        # why the stable is still absent from the spec (docs/backlog.md).
        from sld_layers import decode_colors
        frames = decode_colors((GRAPHICS / "b_west_stable_age2_x1.sld").read_bytes())
        drawn = [f for f in frames if f is not None and not f.empty]
        self.assertTrue(drawn)
        self.assertGreater(drawn[0].width, 0)

    def test_converts_sld_to_playable_byte_identical_atlas(self):
        animation = self.result["entities"]["berries"]["animations"]["idle"]
        expected = animation["frames"] * animation["directions"]
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "a.png"
            second = Path(directory) / "b.png"
            atlas = convert(GRAPHICS / animation["source"], first, expected)
            convert(GRAPHICS / animation["source"], second, expected)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(len(atlas["frames"]), expected)
            with Image.open(first) as image:
                self.assertEqual(image.size, tuple(atlas["size"]))
                self.assertEqual(image.mode, "RGBA")


@unittest.skipUnless(
    AUDIO_PACK.is_file() and shutil.which("vgmstream-cli"),
    "owned sound depot and vgmstream are not installed",
)
class AudioImportIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.banks = read_banks(AUDIO_PACK)

    def test_widget_event_resolves_through_hirc_to_owned_media(self):
        matches = [
            (int(bank.name), media_id)
            for bank in self.banks
            for media_id in resolve_event(bank, "Play_Button_UI")
        ]
        self.assertEqual(matches, [(232745270, 56802692)])

    def test_unit_voices_narrow_to_the_imported_civilisation(self):
        # A unit's voice event covers every civilisation through one switch
        # container, so playing it whole would import forty languages. The
        # militia's selection voice is three files for the Britons — exactly
        # the three the DAT lists for civ 1 (bvmms1..3.wav).
        from import_audio import resolve_event_id
        militia_select = -1993334441
        everyone = [m for bank in self.banks for m in resolve_event_id(bank, militia_select)]
        britons = [m for bank in self.banks for m in resolve_event_id(bank, militia_select, "Britons")]
        self.assertGreater(len(everyone), 100)
        self.assertEqual(len(britons), 3)
        self.assertTrue(set(britons) <= set(everyone))
        # An unknown switch narrows to nothing rather than falling back to all
        # of them, which would be a silent forty-language import.
        self.assertEqual([m for bank in self.banks
                          for m in resolve_event_id(bank, militia_select, "NoSuchCiv")], [])

    def test_every_consumed_cue_resolves_to_owned_media(self):
        # Each alias the game plays has to reach real embedded media: a unit
        # voice that silently resolved to nothing would be a quiet game, not a
        # failed import.
        from import_audio import consumed_cues, resolve_event_id
        ui = Path("public/imported/aoe2/ui/manifest.json")
        content = Path(".local/aoe2de/content.json")
        if not (ui.is_file() and content.is_file()):
            self.skipTest("run the importer first")
        cues = consumed_cues(ui, content)
        self.assertGreater(len(cues), 10)
        for cue in cues:
            media = [m for bank in self.banks for m in resolve_event_id(bank, cue["id"], cue["switch"])]
            self.assertTrue(media, cue["alias"])
        # Every unit the slice trains speaks when it is picked.
        aliases = {cue["alias"] for cue in cues}
        for key in ("villager", "militia", "spearman", "archer", "skirmisher",
                    "scout-cavalry", "trade-cart"):
            self.assertIn(f"{key}-select", aliases)

    def test_vgmstream_regenerates_byte_identical_browser_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui = root / "ui.json"
            ui.write_text(json.dumps({"sounds": {"button_ui": "Play_Button_UI"}}))
            first = import_audio(AUDIO_PACK, ui, root / "first")
            second = import_audio(AUDIO_PACK, ui, root / "second")
            self.assertEqual(first, second)
            cue = first["audio"]["button_ui"]["files"][0]
            self.assertEqual(cue["mediaId"], 56802692)
            self.assertEqual(cue["seconds"], 0.239456)
            self.assertEqual(
                (root / "first" / cue["file"]).read_bytes(),
                (root / "second" / cue["file"]).read_bytes(),
            )


@unittest.skipUnless(WIDGETUI.is_dir() and DAT.is_file(), "owned AoE2DE fixture is not installed")
class UiImportIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.result = extract_ui(
            WIDGETUI, SOUNDS, SPEC, extracted_content(), Path(cls.directory.name), HOTKEYS
        )

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_panels_keep_source_geometry_and_materials(self):
        layouts = self.result["layouts"]
        self.assertEqual(
            set(layouts),
            {"blanktoppanel", "resourcepanel", "commandpanel", "mappanel", "blankbottompanel", "menupanel", "scorepanel"},
        )
        # The score panel is a Surround anchored at the bottom right, its
        # bottom edge at y=1800 (issue #67).
        score = layouts["scorepanel"]["widgets"][0]
        self.assertEqual(score["Name"], "Background")
        self.assertEqual(score["ViewPort"], {"xorigin": 3840, "yorigin": 1800, "width": 400, "height": 400, "alignment": "BottomRight"})
        resource = layouts["resourcepanel"]
        self.assertEqual(resource["viewPort"]["width"], 1935)
        dumped = json.dumps(resource)
        self.assertIn('"ResourceWood"', dumped)
        self.assertIn('"ResourceFood"', dumped)
        self.assertIn('"ResourceGold"', dumped)

    def test_player_coloured_icons_ship_opaque_with_their_weight_beside_them(self):
        # Every unit, building and technology icon material declares
        # `AlphaPlayerColor`: the DDS is opaque except the owner's cloth, whose
        # alpha is how much of the icon's own colour stays and whose RGB is the
        # shading the owner's colour takes (issue #77). A browser canvas
        # premultiplies and would lose that shading, so the importer ships the
        # picture opaque and the weight as a grey mask, white where all of it.
        materials = self.result["materials"]
        icons = self.result["icons"]
        for category in ("Units", "Buildings", "Techs"):
            for material in icons[category].values():
                self.assertEqual(materials[material]["blend"], "AlphaPlayerColor", material)
                self.assertTrue(materials[material]["playerColorMask"].endswith("-playercolor.png"))
        # The stat and menu sheets are plain pictures (a few of the stat icons
        # resolve to no material at all and are recorded as missing).
        for category in ("StatIcons", "MenuIcons"):
            for material in icons[category].values():
                self.assertNotIn("playerColorMask", materials.get(material, {}))
        villager = extracted_content()["entities"]["villager"]["iconId"]
        entry = materials[icons["Units"][f"{villager:03d}"]]
        root = Path(self.directory.name)
        with Image.open(root / entry["texture"]) as picture, Image.open(root / entry["playerColorMask"]) as mask:
            self.assertEqual(picture.size, mask.size)
            self.assertEqual(picture.getchannel("A").getextrema(), (255, 255))
            self.assertEqual(mask.mode, "L")
            weights = mask.histogram()
            # The villager's trousers: a few thousand pixels wholly the
            # owner's, the rest of the portrait none of it.
            self.assertGreater(weights[255], 3000)
            self.assertGreater(weights[0], 50000)
            # Where the weight is whole the picture still carries the shading.
            shaded = [
                picture.getpixel((x, y))[:3]
                for y in range(0, mask.height, 4) for x in range(0, mask.width, 4)
                if mask.getpixel((x, y)) == 255
            ]
            self.assertGreater(len({p for p in shaded}), 50)
            self.assertGreater(max(sum(p) for p in shaded), 300)

    def test_hotkeys_are_the_reference_s_own_keys(self):
        """The letters come from the owned file, not from whoever typed them.

        `hotkeys.json` gives four shipped layouts per binding; we take the
        definitive one. If the import ever stops resolving these, the interface
        silently binds nothing rather than binding something wrong -- so this
        asserts the handful the interface actually consumes.
        """
        hotkeys = self.result["hotkeys"]
        self.assertIn("goto", hotkeys)
        self.assertIn("selectAll", hotkeys)
        # Ctrl+Shift+B is the barracks, Ctrl+B walks to one.
        self.assertEqual(
            hotkeys["selectAll"]["barracks"], {"key": "B", "control": True, "shift": True})
        self.assertEqual(hotkeys["goto"]["barracks"], {"key": "B", "control": True})
        # The town centre is the one the reference gives an unmodified key.
        self.assertEqual(hotkeys["goto"]["town-center"], {"key": "H"})
        # Every action named in the spec resolved to a key.
        for action, mapping in hotkeys.items():
            for name, binding in mapping.items():
                self.assertTrue(binding.get("key"), f"{action}.{name} has no key")

    def test_the_geometry_the_hud_positions_by_survives_the_strip(self):
        """The two boxes issue #35 was about, read back from the extract.

        `strip_widget` keeps an allow-list of fields, and dropping one of these
        is silent: the HUD simply stops finding the widget and falls back to
        the hand-tuned CSS that put the minimap over its own border. The
        command grid hangs off an `Anchor`, which carries its origin in a field
        of that name rather than in a ViewPort, and was the field missing.
        """

        def find(widgets, name):
            for widget in widgets:
                if widget.get("Name") == name:
                    return widget
                found = find(widget.get("ChildWidgets") or [], name)
                if found:
                    return found
            return None

        layouts = self.result["layouts"]
        map_view = find(layouts["mappanel"]["widgets"], "MapView")
        self.assertIsNotNone(map_view)
        self.assertEqual(
            map_view["ViewPort"],
            {"alignment": "CentreCentre", "height": 400, "width": 720, "xorigin": 472, "yorigin": 216},
        )
        buttons = find(layouts["commandpanel"]["widgets"], "Buttons")
        self.assertIsNotNone(buttons)
        self.assertEqual(buttons["Anchor"], {"xorigin": 45, "yorigin": 90})
        first = find(layouts["commandpanel"]["widgets"], "Button11")
        self.assertEqual(first["ViewPort"]["width"], 80)

    def test_blendomatic_walks_to_its_last_byte(self):
        """The blend masks, proven by the file's own arithmetic.

        Nothing about this format is guessed: the modes divide the file
        exactly, the diamond holds exactly one `tile_size` of pixels, and the
        chunks past the dither patterns number exactly the `nr_tiles` the
        header states. If any of those stops being true the decode is wrong
        and the masks would be silently misread rather than fail.
        """
        import numpy as np

        from import_blends import (
            DITHER_CHUNKS, MODE_BYTES, ROWS, TILE_SIZE, NEIGHBOURS,
            coverages, read_modes, single_edge_groups,
        )

        path = ROOT / "depot_813781/resources/_common/dat/blendomatic_x1.dat"
        raw = path.read_bytes()
        modes, tiles = np.frombuffer(raw[:8], dtype="<u4")
        self.assertEqual(len(raw), 8 + int(modes) * MODE_BYTES, "modes do not fill the file")
        self.assertEqual(sum(ROWS), TILE_SIZE, "the diamond is not one tile_size of pixels")

        decoded = read_modes(path)
        self.assertEqual(len(decoded), int(modes))
        for index, masks in enumerate(decoded):
            self.assertEqual(len(masks), int(tiles), f"mode {index} is not nr_tiles masks")
        # Alpha is the classic 0..128, not 0..255.
        self.assertLessEqual(max(int(m.max()) for m in decoded[0]), 128)
        self.assertEqual(DITHER_CHUNKS + int(tiles), 35)

        # Each single-edge group must actually face its own neighbour: the
        # grouping is measured, so this is the measurement holding.
        groups = single_edge_groups(decoded[0])
        cover = coverages(decoded[0])
        self.assertEqual(sorted(groups), sorted(NEIGHBOURS))
        for name, indexes in groups.items():
            self.assertEqual(len(indexes), 4, name)
            for i in indexes:
                strongest = max(cover[i], key=cover[i].get)
                self.assertEqual(strongest, name, f"mask {i} faces {strongest}, not {name}")

    def test_every_material_texture_was_converted(self):
        out = Path(self.directory.name)
        textured = 0
        for name, material in self.result["materials"].items():
            if "texture" in material:
                textured += 1
                self.assertTrue((out / material["texture"]).is_file(), name)
        self.assertGreater(textured, 200)

    def test_entity_icons_and_action_icons_resolve(self):
        icons = self.result["icons"]
        self.assertIn("002", icons["Buildings"])  # barracks
        self.assertIn("028", icons["Buildings"])  # town center
        self.assertIn("008", icons["Units"])  # militia
        self.assertIn("015", icons["Units"])  # villager
        for material in list(icons["Buildings"].values()) + list(icons["Units"].values()):
            self.assertIn("texture", self.result["materials"][material])
        self.assertTrue(
            any(name.startswith("IconAction") for name in self.result["materials"])
        )

    def test_nothing_the_game_can_show_is_left_without_an_icon(self):
        # Adding a unit and forgetting to re-run this import leaves a blank
        # button and nothing else -- no error, no missing file, just a hole in
        # the panel. Every entity that carries an `icon_id` must be in the
        # sheet its category is drawn from.
        icons = self.result["icons"]
        content = extracted_content()
        sheets = {
            "building": "Buildings",
            "unit": "Units", "unit-variant": "Units", "animal": "Units",
        }
        checked = 0
        for key, entity in content["entities"].items():
            sheet = sheets.get(entity.get("category"))
            if sheet is None or "iconId" not in entity:
                continue
            self.assertIn(f"{entity['iconId']:03d}", icons[sheet], f"{key} ({sheet})")
            checked += 1
        self.assertGreater(checked, 30)

    def test_every_technology_gets_its_own_button_art(self):
        # Research buttons were the only ones in the game with no art at all,
        # because the UI import took Buildings, Units and the stat sheets but
        # not Techs. Each technology carries its own `icon_id`.
        icons = self.result["icons"]
        self.assertIn("Techs", icons)
        content = extracted_content()
        for key, tech in content["technologies"].items():
            self.assertIn("iconId", tech, key)
            index = f"{tech['iconId']:03d}"
            self.assertIn(index, icons["Techs"], f"{key} icon {index}")
            material = icons["Techs"][index]
            self.assertIn("texture", self.result["materials"][material], key)
        # The sheet names each entry after the technology, so a wrong id shows
        # up as a wrong name rather than as a plausible picture.
        self.assertEqual(icons["Techs"][f"{content['technologies']['loom']['iconId']:03d}"],
                         "TechIconsT006Loom")
        self.assertEqual(icons["Techs"][f"{content['technologies']['ballistics']['iconId']:03d}"],
                         "TechIconsT025Ballistics")

    def test_west_style_variants_and_sounds_are_included(self):
        self.assertIn("CivWestResourcePanel", self.result["materials"])
        self.assertEqual(self.result["sounds"].get("button_ui"), "Play_Button_UI")


if __name__ == "__main__":
    unittest.main()
