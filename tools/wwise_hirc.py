"""Bounded Wwise 154/172 audio-node layouts (not a mixer).

Independent implementation from the field layouts documented by wwiser
08e937b649bc7007c234bbd59e34a41d5eef3b38, parser/wparser.py:
CAkEvent, LoadSource, NodeBaseParams, RanSeqCntr, SwitchCntr and Action payloads. No wwiser
implementation is included or required. See docs/audio-reference.md.
"""
from functools import lru_cache
from struct import calcsize, unpack_from


class Cursor:
    def __init__(self, data):
        self.data, self.offset = data, 0

    def take(self, size):
        start = self.offset
        if size < 0 or start + size > len(self.data):
            raise ValueError(f'truncated HIRC field at {start}: need {size} bytes')
        self.offset += size
        return self.data[start:self.offset]

    def number(self, fmt):
        return unpack_from('<' + fmt, self.take(calcsize('<' + fmt)))[0]

    def varint(self):
        # Wwise uses most-significant 7-bit group first, not LEB128.
        result = 0
        for _ in range(5):
            byte = self.number('B')
            result = (result << 7) | (byte & 127)
            if result > 0xffffffff:
                break
            if not byte & 128:
                return result
        raise ValueError('invalid HIRC variable integer')

    def ids(self, count):
        data = self.take(count * 4)
        return tuple(unpack_from('<I', data, i * 4)[0] for i in range(count))

    def finish(self):
        if self.offset != len(self.data):
            raise ValueError(f'HIRC unread bytes: consumed {self.offset} of {len(self.data)}')


@lru_cache(maxsize=32768)
def action_type(payload):
    """Validate the entire type3 body before deciding whether it is Play.

    Common154/172 header/property bundles plus the action-specific suffixes
    present in the audited banks. Non-Play is not a synonym for malformed.
    Field layouts: wwiser ActionInitialValues, Active/SetValue/SetState/PlayEvent.
    """
    try:
        c = Cursor(payload)
        kind = c.number('H') >> 8
        c.take(5)  # target ID / bus flag
        for width in (4, 8):
            count = c.number('B')
            keys = c.take(count)
            if len(set(keys)) != count:
                raise ValueError('repeated action property')
            c.take(count * width)
        if kind == 4:
            c.take(9)  # Play: curve, bank ID, bank type
        elif kind in (1, 2, 3, 0x0c):
            # Stop/Pause/Resume: curve + flags. Set bus volume: curve,
            # value meaning and base/min/max floats. All have exception lists.
            c.take(14 if kind == 0x0c else 2)
            c.take(c.varint() * 5)  # exception ID / bus flag
        elif kind == 0x12:
            c.take(8)  # state-group ID and state ID
        elif kind != 0x21:  # PlayEvent has no extra parameters
            raise ValueError(f'unsupported action type {kind:#x}')
        c.finish()
        return kind
    except ValueError as error:
        raise ValueError(f'malformed or unsupported action: {error}') from error


@lru_cache(maxsize=32768)
def event_actions(payload, version):
    if version not in (154, 172):
        raise ValueError(f'unsupported event bank version {version}')
    c = Cursor(payload)
    if version == 172:
        # New event flags/instance limit/cooldown. All owned consumed events
        # use zero. Non-default semantics require a runtime consumer, not a skip.
        if c.take(7) != bytes(7):
            raise ValueError('unsupported v172 event flags/instance limit/cooldown')
    result = c.ids(c.varint())
    c.finish()
    return result


def _properties(c, key_size, value_size, count):
    c.take(count * (key_size + value_size))


def _node_base(c, version):
    # Effect slots: override, count, optional bypass and (slot,ID,flags).
    c.take(1)
    count = c.number('B')
    if count:
        c.take(1 + count * 6)
    # Metadata slots use the same six-byte entries but no bypass byte.
    c.take(1)
    c.take(c.number('B') * 6)
    c.take(9)  # override bus, direct parent, priority/MIDI flags
    _properties(c, 1, 4, c.number('B'))
    _properties(c, 1, 8, c.number('B'))
    positioning = c.number('B')
    if positioning & 1 and positioning & 2:
        c.take(1)  # 3D flags
        if (positioning >> 5) & 3:
            c.take(5)  # automation path mode and transition time
            c.take(c.number('I') * 16)  # XYZ/duration vertices
            count = c.number('I')
            c.take(count * 20)  # vertex spans (8) and XYZ ranges (12)
    aux = c.number('B')
    if aux & 8:
        c.take(16)
    c.take(4)  # reflections bus
    c.take(6)  # advanced voice limits / virtual-voice flags
    for _ in range(c.varint()):
        c.varint()  # state property id
        c.take(2)  # accumulation and decibel flags
    for _ in range(c.varint()):
        c.take(9 if version == 172 else 5)  # group, v172 usage ID, sync
        for _ in range(c.varint()):
            c.take(4)  # state id
            _properties(c, 2, 4, c.number('H'))
    for _ in range(c.number('H')):
        c.take(6)  # RTPC id/type/accumulation
        c.varint()  # parameter id
        c.take(5)  # curve id and scaling
        c.take(c.number('H') * 12)  # From/To/interpolation points


@lru_cache(maxsize=65536)
def audio_node(kind, payload, version):
    """Walk the complete Sound/Random/Switch payload; return only graph edges.

    Fields not used by the current bounded playback model are walked according
    to their counted structures, not searched for coincidental object IDs.
    """
    if version not in (154, 172):
        raise ValueError(f'unsupported audio-node bank version {version}')
    c = Cursor(payload)
    result = {}
    if kind == 2:
        plugin = c.number('I')
        result.update(plugin=plugin, stream=c.number('B'), media=c.number('I'))
        if result['stream'] not in (0, 1, 2):
            raise ValueError(f"unsupported sound stream type {result['stream']}")
        c.take(9)  # cache id, in-memory size, source flags (same154/172)
        if plugin & 15 == 2:
            c.take(c.number('I'))  # sized source-plugin parameters
    elif kind not in (5, 6):
        raise ValueError(f'unsupported audio graph object type {kind}')
    _node_base(c, version)
    if kind == 5:
        c.take(24)  # loop/count ranges, transition/ranges, avoid, modes/flags
        result['children'] = c.ids(c.number('I'))
        playlist = []
        for _ in range(c.number('H')):
            playlist.append(c.number('I'))
            c.take(4)  # signed weight; mixer weighting remains outside scope
        # Split banks may retain playlist IDs whose child objects live in a
        # different bank (owned frontend container6030370 is one example).
        result['playlist'] = tuple(playlist)
    elif kind == 6:
        result['groupType'] = c.number('B')
        result['group'] = c.number('I')
        result['default'] = c.number('I')
        c.take(1)  # continuous validation
        result['children'] = c.ids(c.number('I'))
        result['switches'] = {}
        for _ in range(c.number('I')):
            value = c.number('I')
            children = c.ids(c.number('I'))
            if value in result['switches']:
                raise ValueError('invalid switch group children')
            result['switches'][value] = children
        for _ in range(c.number('I')):
            if c.number('I') not in result['children']:
                raise ValueError('switch parameters reference a non-child')
            c.take(9)  # one flags byte, fade-out/in s32; bit1 renamed in172
    c.finish()
    return result
