"""Synthetic pack boundaries: no owned media needed for these regressions."""
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from import_audio import Bank, Stream, dialogue_leaves, import_audio, music_catalogue, play_parameters, read_audio_packs, read_bank, resolve_event_id, resolve_event_layers, wwise_id
from wwise_pck import PackedFile


def chunk(tag, payload):
    return tag + struct.pack('<I', len(payload)) + payload


def bank(objects, media=None):
    hirc = struct.pack('<I', len(objects))
    for id, type, payload in objects:
        hirc += struct.pack('<BII', type, len(payload) + 4, id) + payload
    result = chunk(b'HIRC', hirc)
    if media is not None:
        didx = b''
        data = b''
        for id, payload in media.items():
            didx += struct.pack('<III', id, len(data), len(payload))
            data += payload
        result += chunk(b'DIDX', didx) + chunk(b'DATA', data)
    return result


def pack(path, banks=(), streams=()):
    # Wwise AKPK v1, no language map entries, byte-addressed payloads.
    header_size = 20 + 4 + 4 + len(banks) * 20 + 4 + len(streams) * 20 + 4
    cursor = header_size + 8
    tables = []
    data = b''
    for entries in (banks, streams):
        table = struct.pack('<I', len(entries))
        for id, payload in entries:
            table += struct.pack('<IIIII', id, 1, len(payload), cursor, 0)
            cursor += len(payload)
            data += payload
        tables.append(table)
    path.write_bytes(b'AKPK' + struct.pack('<IIIIII', header_size, 1, 4,
                     len(tables[0]), len(tables[1]), 4) + struct.pack('<I', 0)
                     + b''.join(tables) + struct.pack('<I', 0) + data)


class AudioPackTest(unittest.TestCase):
    def test_play_action_layers_keep_their_own_media_and_delay(self):
        def play(target, properties=None, ranges=None):
            properties, ranges = properties or {}, ranges or {}
            result = struct.pack('<BBIB', 3, 4, target, 0)
            for values, width in ((properties, 1), (ranges, 2)):
                result += bytes([len(values), *values])
                for key, value in values.items():
                    numbers = [value] if width == 1 else value
                    result += struct.pack('<' + ('f' if key == 60 else 'i') * width, *numbers)
            return result + struct.pack('<BII', 4, 1, 0)
        objects = {1: (4, b'\x02' + struct.pack('<II', 2, 3)),
                   2: (3, play(4)), 3: (3, play(5, {58: 500, 59: 3000, 60: 50}, {58: [-100, 100]})),
                   4: (2, b'\0' * 5 + struct.pack('<I', 11)), 5: (2, b'\0' * 5 + struct.pack('<I', 12))}
        source = Bank('1', objects, {11: b'horn', 12: b'voice'}, version=154)
        layers = resolve_event_layers(source, 1)
        self.assertEqual([layer['media'] for layer in layers], [[11], [12]])
        self.assertEqual(layers[1]['delaySeconds'], 0.5)
        self.assertEqual(layers[1]['delayRange'], [-0.1, 0.1])
        self.assertEqual(layers[1]['fadeSeconds'], 3)
        self.assertEqual(layers[1]['probability'], 50)
        self.assertEqual(resolve_event_id(source, 1), [11, 12])
        with self.assertRaisesRegex(ValueError, 'suffix'):
            play_parameters(play(4) + b'\0')
        with self.assertRaisesRegex(ValueError, 'unsupported.*property'):
            play_parameters(play(4, {57: 1}))

    def test_music_dialogue_orders_named_states_and_excludes_missing_stream_prefixes(self):
        event = wwise_id('Ingame_Music')
        leaves = [(wwise_id('MUSIC02'), 200), (wwise_id('MUSIC01'), 100), (wwise_id('MUSIC03'), 300)]
        tree = struct.pack('<IHHHH', 0, 1, len(leaves), 50, 100)
        tree += b''.join(struct.pack('<IIHH', key, sound, 50, 100) for key, sound in leaves)
        payload = b'\x64' + struct.pack('<II', 1, event) + b'\0' + struct.pack('<I', len(tree)) + b'\0' + tree + b'\0\0'
        self.assertEqual(dialogue_leaves(payload), dict(leaves))
        objects = {event: (15, payload)}
        for sound in (100, 200, 300):
            objects[sound] = (2, struct.pack('<IBI', 0x140001, 1, sound + 1))
        media = {101: Stream(Path('Base.pck'), PackedFile(101, 0, 10, 0)),
                 201: Stream(Path('Base.1.pck'), PackedFile(201, 0, 10, 0)), 301: b'prefix'}
        catalogue = music_catalogue([Bank('1', objects, media)])
        self.assertEqual([row['name'] for row in catalogue['tracks']], ['MUSIC01', 'MUSIC02'])
        self.assertEqual(catalogue['unavailable'][0]['name'], 'MUSIC03')
        self.assertIn('prefetch', catalogue['unavailable'][0]['reason'])
        with self.assertRaisesRegex(ValueError, 'malformed'):
            dialogue_leaves(payload[:-1])

    def test_missing_stream_is_never_mistaken_for_its_embedded_prefix(self):
        objects = {1: (4, b'\x01' + struct.pack('<I', 2)),
                   2: (3, b'\x03\x04' + struct.pack('<I', 3)),
                   3: (2, struct.pack('<IBI', 0x140001, 1, 4))}
        self.assertEqual(resolve_event_id(Bank('1', objects, {4: b'prefix'}), 1), [])

    def test_cross_bank_play_reaches_full_stream_in_second_pack(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, extra = root / 'Base.pck', root / 'Base.1.pck'
            event = (100, 4, b'\x01' + struct.pack('<I', 200))
            action = (200, 3, b'\x03\x04' + struct.pack('<I', 300))
            sound = (300, 2, b'\0' * 5 + struct.pack('<I', 400))
            pack(base, [(1, bank([event, action])), (2, bank([sound], {400: b'prefix'}))])
            pack(extra, streams=[(400, b'prefix and the rest of the sound')])
            banks = read_audio_packs([extra, base])
            matches = [(b, m) for b in banks for m in resolve_event_id(b, 100)]
            self.assertEqual(len(matches), 1)
            b, m = matches[0]
            self.assertEqual((b.name, m), ('1', 400))
            self.assertIsInstance(b.media[m], Stream)
            self.assertEqual(b.media[m].read_bytes(), b'prefix and the rest of the sound')
            self.assertEqual(b.media[m].pack.name, 'Base.1.pck')

    def test_local_event_survives_colliding_bus_and_stop_does_not_play(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Base.pck'
            objects = [(100, 4, b'\x02' + struct.pack('<II', 200, 201)),
                       (200, 3, b'\x03\x04' + struct.pack('<I', 300)),
                       (201, 3, b'\x03\x01' + struct.pack('<I', 301)),
                       (300, 2, b'\0' * 5 + struct.pack('<I', 400)),
                       (301, 2, b'\0' * 5 + struct.pack('<I', 401))]
            pack(path, [(1, bank(objects, {400: b'play', 401: b'stop'})),
                        (2, bank([(100, 8, b'bus')]))])
            self.assertEqual([m for b in read_audio_packs([path])
                              for m in resolve_event_id(b, 100)], [400])

    def test_conflicting_streams_fail_instead_of_last_pack_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / 'a.pck', Path(directory) / 'b.pck'
            pack(a, streams=[(1, b'one')])
            pack(b, streams=[(1, b'two')])
            with self.assertRaisesRegex(ValueError, 'conflicting stream 1'):
                read_audio_packs([a, b])

    def test_malformed_bank_is_not_silently_skipped(self):
        with self.assertRaisesRegex(ValueError, 'truncated HIRC'):
            read_bank('bad', chunk(b'HIRC', struct.pack('<I', 1)))


class ReviewedAudioGapTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pack = self.root / 'Base.pck'
        self.ui = self.root / 'ui.json'
        self.ui.write_text('{"sounds":{}}')
        self.content = self.root / 'content.json'
        self.out = self.root / 'audio'

    def profile(self, sounds, events=(), key='persians', switch='Persians'):
        self.content.write_text(json.dumps({'civilizations': {key: {
            'audio': {'switch': switch}, 'entities': {'trade-cart': {
                'internalName': 'TCART', 'sounds': sounds,
                'animations': {'death': {'soundEvents': [{'event': event} for event in events]}}
            }}}}}))

    def source(self, objects=(), media=None):
        pack(self.pack, [(1, chunk(b'BKHD', struct.pack('<I', 154)) + bank(objects, media))])

    @staticmethod
    def playable(event_id):
        return [(event_id, 4, b'\x01' + struct.pack('<I', 200)),
                (200, 3, struct.pack('<BBIB', 3, 4, 300, 0) + b'\0\0' + struct.pack('<BII', 4, 1, 0)),
                (300, 2, struct.pack('<IBI', 0x140001, 0, 400))]

    @staticmethod
    def decode(args, **kwargs):
        if args[-1] == '-V':
            return subprocess.CompletedProcess(args, 0, '{"version":"fixture"}')
        with wave.open(args[args.index('-o') + 1], 'wb') as output:
            output.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            output.writeframes(struct.pack('<4h', 0, 100, -100, 0))
        return subprocess.CompletedProcess(args, 0)

    def publish(self):
        return import_audio(self.pack, self.ui, self.out, decoder=sys.executable, content=self.content)

    def test_publishes_three_reviewed_gaps_separately_and_decodes_available_cue(self):
        self.profile({'select': -1127052385, 'train': 955679769, 'move': 100}, [2892846699])
        self.source(self.playable(100), {400: b'fixture'})
        with patch('import_audio.subprocess.run', side_effect=self.decode) as decoder:
            first = self.publish()
            self.assertEqual(decoder.call_count, 2, 'one available cue and decoder version, no silent WAVs')
            second = self.publish()
        self.assertEqual(first, second)
        self.assertEqual(set(first['audio']), {'civilizations/persians/trade-cart-move'})
        self.assertEqual(first['unavailable'], {
            f'civilizations/persians/{alias}': {
                'event': event, 'eventId': event_id, 'switch': 'Persians',
                'reason': 'event-absent-from-owned-banks', 'issue': 271,
            } for alias, event, event_id in [
                ('trade-cart-select', 'TCART select', 3167914911),
                ('trade-cart-train', 'TCART train', 955679769),
                ('events/2892846699', 'graphic 2892846699', 2892846699)]})
        self.assertEqual(json.loads((self.out / 'manifest.json').read_text()), first)
        self.assertEqual([p.relative_to(self.out).as_posix() for p in self.out.rglob('*.wav')],
                         ['civilizations/persians/trade-cart-move.wav'])

    def test_unknown_id_alias_or_switch_still_fails(self):
        self.source()
        for sounds, key, switch in [({'select': 123}, 'persians', 'Persians'),
                                    ({'move': 3167914911}, 'persians', 'Persians'),
                                    ({'select': 3167914911}, 'unreviewed-civ', 'UnreviewedCiv'),
                                    ({'select': 3167914911}, 'saracens', 'Persians'),
                                    ({'select': 3167914911}, 'persians', 'Britons')]:
            with self.subTest(sounds=sounds, key=key, switch=switch):
                self.profile(sounds, key=key, switch=switch)
                with self.assertRaisesRegex(ValueError, 'did not resolve to complete media'):
                    self.publish()

    def test_saracen_source_gaps_have_their_own_evidence_and_recovered_events_decode(self):
        self.profile({'select': -1127052385, 'train': 955679769}, [2892846699], 'saracens', 'Saracens')
        self.source()
        with patch('import_audio.subprocess.run', side_effect=self.decode):
            missing = self.publish()
        self.assertEqual(len(missing['unavailable']), 3)
        self.assertTrue(all(row['issue'] == 271 and row['switch'] == 'Saracens'
                            for row in missing['unavailable'].values()))
        self.assertEqual(missing['audio'], {})
        self.profile({'select': 3167914911}, key='saracens', switch='Saracens')
        self.source(self.playable(3167914911), {400: b'fixture'})
        with patch('import_audio.subprocess.run', side_effect=self.decode):
            recovered = self.publish()
        self.assertNotIn('unavailable', recovered)
        self.assertTrue(recovered['audio']['civilizations/saracens/trade-cart-select']['files'])
        self.source(self.playable(3167914911))
        with self.assertRaises(ValueError):
            self.publish()

    def test_present_but_broken_event_never_qualifies_as_absent(self):
        event_id = 3167914911
        self.profile({'select': event_id})
        for objects in [[(event_id, 8, b'wrong type')],
                        [(event_id, 4, b'\x01' + struct.pack('<I', 999))],
                        [(event_id, 4, b'\x01')],
                        self.playable(event_id)]:
            with self.subTest(objects=objects):
                self.source(objects)  # last case has a sound but no media
                with self.assertRaises(ValueError):
                    self.publish()
        # A stream prefix is still not a complete replacement sound.
        objects = self.playable(event_id)
        objects[-1] = (300, 2, struct.pack('<IBI', 0x140001, 1, 400))
        self.source(objects, {400: b'incomplete prefix'})
        with self.assertRaisesRegex(ValueError, 'did not resolve to complete media'):
            self.publish()

    def test_recovered_event_uses_real_decode_and_decode_failures_propagate(self):
        self.profile({'select': 3167914911})
        self.source(self.playable(3167914911), {400: b'fixture'})
        with patch('import_audio.subprocess.run', side_effect=self.decode):
            result = self.publish()
        self.assertNotIn('unavailable', result)
        self.assertTrue(result['audio']['civilizations/persians/trade-cart-select']['files'])
        with patch('import_audio.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'decoder')):
            with self.assertRaises(subprocess.CalledProcessError):
                self.publish()

    def test_no_banks_is_not_evidence_for_a_reviewed_source_gap(self):
        self.profile({'select': 3167914911})
        pack(self.pack)
        with self.assertRaisesRegex(ValueError, 'did not resolve to complete media'):
            self.publish()


if __name__ == '__main__':
    unittest.main()
