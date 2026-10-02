"""Replay the historical BC1 fix against real owned x1 cache/publication trees.

Every arm runs npm run import:aoe2, privately. The corrected global arm starts
with an empty publication and a genuine, changed legacy decoder cache; the
layer-aware arm retains the old publication and schema2 cache. GNU time measures
the atlas stage separately so unrelated cold audio/UI work is not a speedup.
No owned input, live publication, or production decoder is modified.
"""
from __future__ import annotations

import argparse
import ast
from collections import Counter
import hashlib
import inspect
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))


def git(*args: str) -> bytes:
    return subprocess.check_output(['git', *args], cwd=ROOT)


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def publication(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): digest(p) for p in sorted(root.rglob('*')) if p.is_file()}


def tree_digest(files: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def pixel_samples(study: Path) -> dict:
    """Independent decoded-PNG evidence, outside every timed import stage."""
    import numpy as np
    from PIL import Image
    inventory = json.loads((study / 'baseline-inventory.json').read_text())
    samples = {}
    for wanted in ('main', 'playercolor'):
        for image, layer in sorted(inventory['pages'].items()):
            if layer != wanted:
                continue
            paths = [study / arm / 'public/imported/aoe2' / image
                     for arm in ('baseline-old', 'corrected-global', 'corrected-aware')]
            if digest(paths[0]) == digest(paths[1]):
                continue
            arrays = []
            for path in paths:
                with Image.open(path) as opened:
                    arrays.append(np.array(opened.convert('RGBA')))
            before, after, cached = arrays
            if not np.array_equal(after, cached):
                raise ValueError(f'cached/fresh decoded pixels differ: {image}')
            # Compare only aligned whole-atlas samples; the full file-tree
            # comparison above already covers every corrected frame/page.
            if before.shape != after.shape:
                continue
            different = np.any(before != after, axis=2)
            count = int(np.count_nonzero(different))
            visible = different & ((before[:, :, 3] > 0) | (after[:, :, 3] > 0))
            visible_count = int(np.count_nonzero(visible))
            if not visible_count:
                continue
            y, x = divmod(int(visible.argmax()), before.shape[1])
            samples[wanted] = {'image': image, 'space': 'decoded PNG RGBA8, no colour-space conversion',
                               'changedPixels': count, 'changedNontransparentPixels': visible_count, 'sampleXY': [x, y],
                               'before': before[y, x].tolist(), 'after': after[y, x].tolist(),
                               'beforePixelSha256': hashlib.sha256(before.tobytes()).hexdigest(),
                               'afterPixelSha256': hashlib.sha256(after.tobytes()).hexdigest()}
            break
        if wanted not in samples:
            raise ValueError(f'no aligned changed RGBA8 sample for {wanted}')
    (study / 'pixel-evidence.json').write_text(json.dumps(samples, indent=2) + '\n')
    return samples


def legacy_cache(source: Path, target: Path, inventory: Path) -> None:
    """Separate process: release the large parsed cache before any decoder starts."""
    from convert_sld import page_path
    stored = json.loads(source.read_text())
    if stored.get('schema') != 2:
        raise ValueError('expected a genuine schema2 baseline cache')
    groups, pages, identifiers = set(), {}, {}
    for identifier, entry in stored['atlases'].items():
        layer = entry['layer']
        groups.add((entry['source'], entry['expected'], layer))
        identifiers[identifier] = layer
        atlas = entry['atlas']
        if atlas:
            for page in range(len(atlas.get('pages', [0]))):
                image = page_path(Path(entry['image']), page).as_posix()
                if image in pages and pages[image] != layer:
                    raise ValueError(f'conflicting page layers: {image}')
                pages[image] = layer
        del entry['layer'], entry['decoder']
    del stored['schema']
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('w') as output:
        json.dump(stored, output, separators=(',', ':'), sort_keys=True)
        output.write('\n')
    inventory.write_text(json.dumps({'groupsByLayer': dict(Counter(g[2] for g in groups)),
                                    'pages': pages, 'identifiers': identifiers}, sort_keys=True))


def metrics(path: Path) -> dict:
    text = path.read_text()
    def field(label: str) -> str:
        match = re.search(r'^\s*' + re.escape(label) + r':\s*(.+)$', text, re.M)
        if not match:
            raise ValueError(f'missing GNU time field {label} in {path}')
        return match[1]
    elapsed = field('Elapsed (wall clock) time (h:mm:ss or m:ss)').split(':')
    seconds = 0.0
    for part in elapsed:
        seconds = seconds * 60 + float(part)
    return {'elapsedSeconds': seconds, 'userSeconds': float(field('User time (seconds)')),
            'systemSeconds': float(field('System time (seconds)')),
            'maxProcessRssKiB': int(field('Maximum resident set size (kbytes)'))}


def archive(revision: str, destination: Path) -> None:
    destination.mkdir()
    with tarfile.open(fileobj=io.BytesIO(git('archive', revision))) as bundle:
        bundle.extractall(destination, filter='data')


def instrument(root: Path) -> None:
    script = root / 'tools/import_aoe2.sh'
    text = script.read_text()
    anchor = 'uv run --project "$ROOT" --locked python "$ROOT/tools/convert_sld.py"'
    if text.count(anchor) != 1:
        raise ValueError('full import atlas-stage anchor changed')
    script.write_text(text.replace(anchor, '/usr/bin/time -v -o "$ROOT/.local/atlas-stage.time" ' + anchor))


def run_import(root: Path, study: Path, depot: Path, timeout: int) -> dict:
    name = root.name
    (root / '.local').mkdir(exist_ok=True)
    env = {**os.environ, 'AOE2DE_DEPOT_ROOT': str(depot), 'PYTHONUNBUFFERED': '1', 'LC_ALL': 'C',
           'PYTHONPATH': '', 'UV_PROJECT_ENVIRONMENT': str(root / '.venv')}
    env.pop('VIRTUAL_ENV', None)
    command = ['/usr/bin/time', '-v', '-o', str(study / f'{name}-pipeline.time'),
               'nice', '-n', '10', 'npm', 'run', 'import:aoe2']
    started = time.time()
    with (study / f'{name}.log').open('w') as output:
        proc = subprocess.Popen(command, cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        (study / 'active.json').write_text(json.dumps({'stage': name, 'pid': proc.pid, 'pgid': proc.pid, 'started': started}))
        print(json.dumps({'event': 'start', 'stage': name, 'pid': proc.pid, 'at': started}), flush=True)
        try:
            result = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            raise
    (study / f'{name}.exit').write_text(f'{result}\n')
    if result:
        raise RuntimeError(f'{name} import exited {result}; see {study / (name + ".log")}')
    # Do not start another decoder with a surviving child from this phase.
    try:
        os.killpg(proc.pid, 0)
    except ProcessLookupError:
        pass
    else:
        raise RuntimeError(f'{name} left process group {proc.pid} alive')
    log = (study / f'{name}.log').read_text()
    reused = re.findall(r'^(\d+) atlases reused from ', log, re.M)
    if len(reused) != 1:
        raise ValueError(f'{name}: expected one complete atlas stage')
    result = {'atlas': metrics(root / '.local/atlas-stage.time'),
              'pipeline': metrics(study / f'{name}-pipeline.time'), 'reusedGroups': int(reused[0]),
              'started': started, 'finished': time.time()}
    print(json.dumps({'event': 'complete', 'stage': name, **result}), flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='.local/cache257-study')
    parser.add_argument('--revision', default='HEAD')
    parser.add_argument('--old-decoder', default='5be3f31^')
    parser.add_argument('--resources-depot', type=Path,
                        help='optional existing recovered pinned813784 root, linked read-only')
    parser.add_argument('--stage-timeout', type=int, default=3600)
    parser.add_argument('--verify-pixels', type=Path, help='decode representative pixels from a completed study, without repeating imports')
    parser.add_argument('--legacy-cache', nargs=3, type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.legacy_cache:
        legacy_cache(*args.legacy_cache)
        return
    if args.verify_pixels:
        if json.loads((args.verify_pixels / 'report.json').read_text()).get('result') != 'GREEN':
            raise ValueError('pixel verification requires a complete passing byte-comparison study')
        print(json.dumps(pixel_samples(args.verify_pixels), indent=2))
        return
    from atlas_cache import fingerprints
    from convert_sld import convert, convert_mask, page_path, save_pages, MASK_LAYERS
    from depot import depot_root
    study = (ROOT / args.out).resolve()
    if not study.is_relative_to(ROOT / '.local') or study.exists():
        raise ValueError('use a new directory under .local; existing work is never overwritten')
    revision = git('rev-parse', args.revision).decode().strip()
    for path in ('tools/sld_layers.py', 'tools/convert_sld.py', 'tools/atlas_cache.py', 'tools/import_aoe2.sh', 'tools/import-spec.json'):
        if (ROOT / path).read_bytes() != git('show', f'{revision}:{path}'):
            raise ValueError(f'working source differs from benchmark revision: {path}')
    current = git('show', f'{revision}:tools/sld_layers.py').decode()
    old = git('show', f'{args.old_decoder}:tools/sld_layers.py').decode()
    def unrelated(source: str) -> list[str]:
        return [ast.dump(n) for n in ast.parse(source).body if getattr(n, 'name', '') != '_rgb565']
    if unrelated(old) != unrelated(current) or old == current:
        raise ValueError('historical decoder must differ only in the real RGB565 helper')
    conversion = '\n'.join(inspect.getsource(fn) for fn in (convert, convert_mask, page_path, save_pages)) + repr(MASK_LAYERS)
    old_fp, new_fp = fingerprints(old, conversion), fingerprints(current, conversion)
    changed = {layer for layer in new_fp if old_fp[layer] != new_fp[layer]}
    if changed != {'main', 'playercolor'}:
        raise ValueError(f'unexpected BC1 dependency boundary: {changed}')
    study.mkdir()
    view = study / 'base-depots'
    view.mkdir()
    for path in depot_root().iterdir():
        if path.is_dir() and path.name.startswith('depot_') and path.name != 'depot_1039811':
            target = args.resources_depot if path.name == 'depot_813784' and args.resources_depot else path
            target = target.resolve()
            if path.name == 'depot_813784' and not (target / 'resources/_common/drs/graphics').is_dir():
                raise ValueError(f'missing resources depot graphics: {target}')
            (view / path.name).symlink_to(target, target_is_directory=True)
    baseline, global_run, aware = (study / name for name in ('baseline-old', 'corrected-global', 'corrected-aware'))
    archive(revision, baseline)
    (baseline / 'tools/sld_layers.py').write_text(old)
    instrument(baseline)
    report = {'revision': revision, 'historicalDecoder': args.old_decoder, 'scale': 1,
              'workers': max(1, min(4, (os.cpu_count() or 1) // 2)),
              'resourcesDepotOverride': str(args.resources_depot.resolve()) if args.resources_depot else None,
              'oldDecoderSha256': hashlib.sha256(old.encode()).hexdigest(),
              'correctedDecoderSha256': hashlib.sha256(current.encode()).hexdigest(),
              'changedLayers': sorted(changed), 'stages': {}}
    report['stages']['baseline'] = run_import(baseline, study, view, args.stage_timeout)
    if report['stages']['baseline']['reusedGroups'] != 0:
        raise ValueError('baseline must be a genuine cold old-decoder import')
    # Copy only our generated export; never the live publication or owned input.
    shutil.copytree(baseline, aware, ignore=shutil.ignore_patterns('.venv'))
    (aware / 'tools/sld_layers.py').write_text(current)
    archive(revision, global_run)
    instrument(global_run)
    cache_relative = Path('.local/aoe2de/atlas-cache.json')
    inventory_path = study / 'baseline-inventory.json'
    subprocess.run([sys.executable, str(Path(__file__).resolve()), '--legacy-cache',
                    str(baseline / cache_relative), str(global_run / cache_relative), str(inventory_path)], check=True)
    inventory = json.loads(inventory_path.read_text())
    report['groupsByLayer'] = inventory['groupsByLayer']
    report['stages']['global'] = run_import(global_run, study, view, args.stage_timeout)
    report['stages']['aware'] = run_import(aware, study, view, args.stage_timeout)
    expected_reuse = sum(count for layer, count in inventory['groupsByLayer'].items() if layer not in changed)
    if report['stages']['global']['reusedGroups'] != 0 or report['stages']['aware']['reusedGroups'] != expected_reuse:
        raise ValueError('cache hits do not match the independent baseline layer inventory')
    converted = Counter(inventory['identifiers'][line] for line in (study / 'corrected-aware.log').read_text().splitlines()
                        if line in inventory['identifiers'])
    if dict(converted) != {layer: inventory['groupsByLayer'][layer] for layer in changed}:
        raise ValueError(f'wrong actual converted layers: {converted}')
    trees = {name: publication(path / 'public/imported/aoe2') for name, path in
             (('baseline', baseline), ('global', global_run), ('aware', aware))}
    if trees['global'] != trees['aware']:
        differences = [name for name in sorted(trees['global'].keys() | trees['aware'].keys())
                       if trees['global'].get(name) != trees['aware'].get(name)]
        (study / 'differences.json').write_text(json.dumps(differences, indent=2))
        raise ValueError(f'{len(differences)} publication differences; see differences.json')
    if digest(global_run / cache_relative) != digest(aware / cache_relative):
        raise ValueError('corrected cache metadata differs')
    pixel_changes = Counter()
    for image, layer in inventory['pages'].items():
        if trees['baseline'].get(image) != trees['global'].get(image):
            pixel_changes[layer] += 1
    if set(pixel_changes) != changed:
        raise ValueError(f'historical change did not alter exactly BC1-dependent page bytes: {pixel_changes}')
    samples = pixel_samples(study)
    report.update({'publicationFiles': len(trees['global']), 'publicationTreeSha256': tree_digest(trees['global']),
                   'cacheSha256': digest(aware / cache_relative), 'changedPagesByLayer': dict(pixel_changes),
                   'actuallyConvertedByLayer': dict(converted), 'pixelSamples': samples, 'result': 'GREEN'})
    (study / 'publication-hashes.json').write_text(json.dumps(trees['global'], sort_keys=True))
    (study / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
