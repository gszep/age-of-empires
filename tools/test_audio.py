"""Synthetic pack boundaries: no owned media needed for these regressions."""
import struct
import tempfile
import unittest
from pathlib import Path

from import_audio import Stream, read_audio_packs, read_bank, resolve_event_id


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


if __name__ == '__main__':
    unittest.main()
