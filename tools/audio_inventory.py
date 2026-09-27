#!/usr/bin/env python3
"""Audit owned pack metadata without extracting or publishing game assets."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path

from depot import depot_root
from import_audio import Stream, read_audio_packs, resolve_event_id
from wwise_pck import read_index


def inventory(packs: list[Path], events: list[int], switch: str) -> dict:
    sources = []
    for pack in sorted(packs):
        with pack.open('rb') as handle:
            index = read_index(handle)
        sources.append({'pack': pack.name, 'bytes': pack.stat().st_size,
                        'banks': len(index['banks']), 'streams': len(index['streams'])})
    banks = read_audio_packs(packs)
    return {
        'packs': sources,
        'banks': [{'id': int(bank.name), 'pack': bank.pack,
                   'localObjectTypes': dict(sorted(Counter(
                       kind for kind, _ in bank.objects.maps[0].values()).items()))}
                  for bank in banks],
        'events': {str(event & 0xffffffff): [
            {'bankId': int(bank.name), 'mediaId': media,
             'pack': bank.media[media].pack.name if isinstance(bank.media[media], Stream) else bank.pack,
             'storage': 'stream' if isinstance(bank.media[media], Stream) else 'embedded'}
            for bank in banks for media in resolve_event_id(bank, event, switch)] for event in events},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', type=Path, action='append')
    parser.add_argument('--event', type=int, action='append', default=[])
    parser.add_argument('--switch', default='Britons')
    args = parser.parse_args()
    packs = args.pack or [depot_root() / 'depot_813783/wwise' / name
                          for name in ('Base.pck', 'Base.1.pck')]
    print(json.dumps(inventory(packs, args.event, args.switch), indent=2, sort_keys=True))
