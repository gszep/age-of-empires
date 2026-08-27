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
TERRAIN = ROOT / "depot_813782/resources/_common/terrain/textures/2x"
AUDIO_PACK = ROOT / "depot_813783/wwise/Base.pck"
SPEC = json.loads(Path(__file__).with_name("import-spec.json").read_text())
SOURCE = Path(__file__).with_name("aoe2-source.json")


@lru_cache(maxsize=1)
def extracted_content():
    return extract(DAT, GRAPHICS, PALETTES, SPEC, json.loads(SOURCE.read_text()))


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
        stump = entities["tree-oak"]["animations"]["decay"]
        self.assertEqual(stump["source"], "n_tree_stump_generic_x1.sld")
        self.assertEqual(stump["frames"], 1)
        self.assertEqual(entities["berries"]["animations"]["decay"]["source"], stump["source"])
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
        # melee armour, +2 pierce.
        self.assertEqual(loom["effects"], [{
            "unit": "villager", "hitPoints": 15,
            "armors": [{"class": 4, "amount": 1}, {"class": 3, "amount": 2}],
        }])

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
        # units that pick their own fights.
        self.assertNotIn("combat", entities["monk"])
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
        self.assertEqual(skirmisher["train"], {"buildingId": 87, "seconds": 26})
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
        self.assertEqual(scout["train"], {"buildingId": stable["id"], "seconds": 30})
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
        self.assertEqual(cart["train"], {"buildingId": 84, "seconds": 51})
        # The route's economics come from the unit, not from a constant: its
        # work rate is what the road pays per second and its capacity the cap.
        self.assertEqual(cart["trade"], {
            "ratePerSecond": 0.2875, "capacity": 100, "buildingId": 84,
        })
        # A laden cart has its own art, named by the trade task itself.
        self.assertEqual(cart["animations"]["carry"]["source"], "u_trade_cart_west_walkA_x1.sld")
        self.assertNotIn("combat", cart)

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

    def test_ground_terrain_comes_from_the_dat(self):
        ground = self.result["terrain"]["ground"]
        # Grass is DAT terrain 0; its texture name and tile span drive the
        # renderer, so neither may be transcribed by hand.
        self.assertEqual(ground["terrainId"], 0)
        self.assertEqual(ground["name"], "Grass")
        self.assertEqual(ground["texture"], "g_grs")
        self.assertEqual(ground["dimensions"], [10, 10])

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
        self.assertEqual(unit["train"], {"buildingId": 12, "seconds": 21})
        self.assertIn({"class": 4, "amount": 4}, unit["combat"]["attacks"])
        self.assertIn({"class": 3, "amount": 1}, unit["combat"]["armors"])
        self.assertEqual(unit["combat"]["reloadSeconds"], 2.0)

    def test_economy_entities_carry_dat_backed_rules(self):
        entities = self.result["entities"]
        self.assertEqual(entities["villager"]["train"], {"buildingId": 109, "seconds": 25})
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
        again = extract(DAT, GRAPHICS, PALETTES, SPEC, json.loads(SOURCE.read_text()))
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
            WIDGETUI, SOUNDS, SPEC, extracted_content(), Path(cls.directory.name)
        )

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_panels_keep_source_geometry_and_materials(self):
        layouts = self.result["layouts"]
        self.assertEqual(
            set(layouts),
            {"blanktoppanel", "resourcepanel", "commandpanel", "mappanel", "blankbottompanel", "menupanel"},
        )
        resource = layouts["resourcepanel"]
        self.assertEqual(resource["viewPort"]["width"], 1935)
        dumped = json.dumps(resource)
        self.assertIn('"ResourceWood"', dumped)
        self.assertIn('"ResourceFood"', dumped)
        self.assertIn('"ResourceGold"', dumped)

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

    def test_west_style_variants_and_sounds_are_included(self):
        self.assertIn("CivWestResourcePanel", self.result["materials"])
        self.assertEqual(self.result["sounds"].get("button_ui"), "Play_Button_UI")


if __name__ == "__main__":
    unittest.main()
