"""Authored binary layouts, not bank excerpts or converted game data."""
import struct
import tempfile
import unittest
from pathlib import Path

from import_audio import (Bank, read_bank, read_audio_packs, resolve_event_id, resolve_event_layers,
                          music_catalogue, play_parameters, wwise_id)
from wwise_hirc import audio_node, event_actions
from wwise_pck import read_index
from test_audio import bank, chunk, pack


def p(fmt, *values):
    return struct.pack('<' + fmt, *values)


def base(version=172, rich=False):
    if not rich:
        return bytes(4) + p('IIB', 0, 0, 0) + bytes(2 + 1 + 5 + 6 + 2 + 2)
    # Nonempty FX, metadata, properties, 3D path, aux, state and RTPC records.
    data = bytes([1, 1, 0]) + p('BIB', 0, 999, 0)
    data += bytes([1, 1]) + p('BIB', 0, 999, 1)
    data += p('IIB', 999, 999, 0)
    data += bytes([1, 0]) + p('f', 0) + bytes([1, 0]) + p('ff', -1, 1)
    data += bytes([35, 0, 0]) + p('iI', 100, 1) + p('fffi', 0, 1, 2, 100)
    data += p('IIIfff', 1, 0, 1, 1, 1, 1)
    data += bytes([8]) + p('5I', 0, 0, 0, 0, 0) + bytes(6)
    data += b'\x01\x81\x02\x00\x00'  # one state prop, varint130, flags
    data += b'\x01' + p('I', 888)
    if version == 172:
        data += p('I', 777)  # new group-usage id
    data += bytes([0, 1]) + p('IHHf', 666, 1, 20, 1)
    data += p('HIBB', 1, 555, 0, 0) + b'\x81\x02' + p('IBHffI', 444, 0, 1, 0, 1, 4)
    return data


def sound(media, version=172, rich=False):
    return p('IBIIIB', 0x140001, 0, media, 0, 0, 0) + base(version, rich)


def random_node(child, version=172, rich=False):
    return base(version, rich) + bytes(24) + p('IIHIi', 1, child, 1, child, 50)


def switch_node():
    data = base(rich=True) + p('BIIB', 0, wwise_id('Civilization'), 0, 0)
    data += p('III', 2, 4, 5) + p('I', 2)
    data += p('III', wwise_id('Britons'), 1, 4) + p('III', wwise_id('Incas'), 1, 5)
    data += p('I', 2) + p('IBii', 4, 0, 0, 0) + p('IBii', 5, 2, 100, 200)
    return data


def play(target):
    return p('BBIB', 3, 4, target, 0) + bytes(2) + p('BII', 4, 123, 0)


class WwiseLayoutTest(unittest.TestCase):
    def test_v172_event_header_and_multibyte_count_are_exact(self):
        for version, prefix in [(154, b''), (172, bytes(7))]:
            payload = prefix + b'\x81\x00' + p('128I', *range(128))
            self.assertEqual(event_actions(payload, version), tuple(range(128)))
            for broken in (payload[:-1], payload + b'\0'):
                with self.assertRaises(ValueError):
                    event_actions(broken, version)
        with self.assertRaisesRegex(ValueError, 'instance limit'):
            event_actions(b'\x01' + bytes(6) + b'\0', 172)
        with self.assertRaisesRegex(ValueError, 'version'):
            event_actions(b'\0', 173)

    def test_full_sound_and_random_walk_both_versions_with_state_groups(self):
        for version in (154, 172):
            for rich in (False, True):
                for kind, payload in [(2, sound(11, version, rich)), (5, random_node(11, version, rich))]:
                    with self.subTest(version=version, rich=rich, kind=kind):
                        node = audio_node(kind, payload, version)
                        self.assertEqual(node['media'] if kind == 2 else node['playlist'][0], 11)
                        for broken in (payload[:-1], payload + b'\0'):
                            with self.assertRaises(ValueError):
                                audio_node(kind, broken, version)

    def test_v172_switch_and_play_graph_ignore_incidental_object_ids(self):
        event = bytes(7) + b'\x01' + p('I', 2)
        objects = [(1, 4, event), (2, 3, play(3)), (3, 6, switch_node()),
                   (4, 5, random_node(6)), (5, 2, sound(12)),
                   (6, 2, sound(11, rich=True)), (999, 2, sound(99))]
        data = bank(objects, {11: b'a', 12: b'b', 99: b'noise'}, version=172)
        b = read_bank('fixture', data)
        self.assertEqual(resolve_event_layers(b, 1, 'Britons')[0]['media'], [11])
        self.assertEqual(resolve_event_layers(b, 1, 'Incas')[0]['media'], [12])
        self.assertEqual(resolve_event_layers(b, 1, 'Unknown'), [])
        with self.assertRaisesRegex(ValueError, 'HIRC6'):
            read_bank('bad', bank([(3, 6, switch_node() + b'\0')], version=172))

    def test_split_bank_playlist_references_are_not_replaced_by_children(self):
        # A playlist may name objects from another bank, unlike its local child
        # inventory. Neither unrelated child IDs nor parent/FX IDs are played.
        payload = base() + bytes(24) + p('IIHIi', 1, 999, 1, 4, 50)
        objects = {1: (4, bytes(7) + b'\1' + p('I', 2)), 2: (3, play(3)),
                   3: (5, payload), 4: (2, sound(11)), 999: (2, sound(99))}
        self.assertEqual(resolve_event_layers(Bank('b', objects, {11: b'a', 99: b'b'}, version=172), 1)[0]['media'], [11])

    def test_structural_154_control_preserves_pool_but_follows_playlist_order(self):
        payload = base(154) + bytes(24) + p('IIIHIiIi', 2, 4, 5, 2, 5, 50, 4, 50)
        objects = {1: (4, b'\1' + p('I', 2)), 2: (3, play(3)), 3: (5, payload),
                   4: (2, sound(11, 154)), 5: (2, sound(12, 154))}
        source = Bank('b', objects, {11: b'a', 12: b'b'}, version=154)
        legacy = resolve_event_layers(source, 1)[0]
        structural = resolve_event_layers(source, 1, structural=True)[0]
        self.assertEqual(legacy['media'], [11, 12])
        self.assertEqual(structural['media'], [12, 11])
        self.assertEqual({**legacy, 'media': sorted(legacy['media'])},
                         {**structural, 'media': sorted(structural['media'])})

    def test_v172_play_parameters_keep_existing_timing_layout_and_semantic_guards(self):
        payload = p('BBIB', 3, 4, 3, 0) + bytes([3, 58, 59, 60]) + p('iif', 500, 1000, 75)
        payload += bytes([1, 58]) + p('ii', -100, 100) + p('BII', 4, 123, 0)
        self.assertEqual(play_parameters(payload), {'delaySeconds': .5, 'delayRange': [-.1, .1],
            'fadeSeconds': 1, 'fadeRange': [0, 0], 'probability': 75, 'probabilityRange': [0, 0], 'curve': 4})
        curve = payload[:-9] + bytes([6]) + payload[-8:]
        self.assertEqual(play_parameters(curve, validate_playback=False)['curve'], 6)
        with self.assertRaisesRegex(ValueError, 'curve'):
            play_parameters(curve)

    def test_v172_bank_framing_and_duplicate_objects_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'BKHD'):
            read_bank('bad', chunk(b'BKHD', p('I', 172)) + bank([], version=None))
        with self.assertRaisesRegex(ValueError, 'duplicate HIRC'):
            read_bank('bad', bank([(1, 4, b'\0'), (1, 4, b'\0')]))
        with self.assertRaisesRegex(ValueError, 'duplicate Wwise'):
            read_bank('bad', bank([]) + bank([]))

    def test_v172_broken_play_layer_cannot_be_hidden_by_a_valid_layer(self):
        objects = {1: (4, bytes(7) + b'\x02' + p('II', 2, 3)),
                   2: (3, play(4)), 3: (3, play(5)),
                   4: (2, sound(11)), 5: (2, sound(12))}
        with self.assertRaisesRegex(ValueError, 'missing audio graph medium 12'):
            resolve_event_layers(Bank('b', objects, {11: b'valid'}, version=172), 1)
        del objects[3]
        with self.assertRaisesRegex(ValueError, 'event action 3'):
            resolve_event_layers(Bank('b', objects, {11: b'valid'}, version=172), 1)

    def test_malformed_sibling_action_fails_at_load_and_both_resolvers(self):
        malformed = [b'', b'\x03', b'\x03\x04', play(5)[:6], play(5)[:9],
                     play(5)[:-1], play(5) + b'\0', p('BBIB', 3, 1, 5, 0) + bytes(2)]
        for version in (154, 172):
            event = (bytes(7) if version == 172 else b'') + b'\x02' + p('II', 2, 3)
            for body in malformed:
                objects = {1: (4, event), 2: (3, play(4)), 3: (3, body),
                           4: (2, sound(11, version))}
                with self.subTest(version=version, body=body):
                    with self.assertRaisesRegex(ValueError, 'action'):
                        read_bank('bad', bank([(key, *value) for key, value in objects.items()], version=version))
                    for resolver in (resolve_event_id, resolve_event_layers):
                        with self.assertRaisesRegex(ValueError, 'action'):
                            resolver(Bank('bad', objects, {11: b'valid'}, version=version), 1)

    def test_unknown_bank_versions_fail_before_sharing_or_music(self):
        for version in (0, 153, 171, 173, 999):
            with self.subTest(version=version):
                data = bank([(2, 3, play(3))], version=version)
                with self.assertRaisesRegex(ValueError, 'unsupported bank version'):
                    read_bank('unknown', data)
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory)/'test.pck'
                    pack(path, [(1, bank([(1, 4, b'\x01' + p('I', 2))])), (2, data)])
                    with self.assertRaisesRegex(ValueError, 'unsupported bank version'):
                        read_audio_packs([path])
                with self.assertRaisesRegex(ValueError, 'unsupported bank version'):
                    music_catalogue([Bank('unknown', {}, {}, version=version)])
        for data in (bank([], version=None), chunk(b'BKHD', b'\0') + bank([], version=None)):
            with self.assertRaisesRegex(ValueError, 'BKHD'):
                read_bank('missing-version', data)
    def test_akpk_language_map_handles_english_and_sfx(self):
        import io
        languages = p('IIIII', 2, 20, 1, 26, 0) + 'en\0sfx\0'.encode('utf-16le')
        header = p('IIIII', 1, len(languages), 4, 4, 4) + languages + bytes(12)
        data = b'AKPK' + p('I', len(header)) + header
        self.assertEqual(read_index(io.BytesIO(data)), {'banks': [], 'streams': []})
        data = data[:32] + p('I', 0) + data[36:]
        with self.assertRaisesRegex(ValueError, 'language string offset'):
            read_index(io.BytesIO(data))

    def test_akpk_v1_tables_are_bounded_and_unknown_versions_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'test.pck'
            pack(path, [(1, b'bank')], [(2, b'stream')])
            original = path.read_bytes()
            with path.open('rb') as f:
                self.assertEqual(len(read_index(f)['streams']), 1)
            for data in (original[:-1], original[:8] + p('I', 2) + original[12:],
                         original[:16] + p('I', 100) + original[20:]):
                path.write_bytes(data)
                with self.subTest(data=data), path.open('rb') as f, self.assertRaises(ValueError):
                    read_index(f)


if __name__ == '__main__':
    unittest.main()
