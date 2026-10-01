"""A named gate log remains discoverable after success, failure or interruption."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class GateStatusTest(unittest.TestCase):
    def test_named_log_records_success_and_failure(self):
        steps = ('test', 'run build', 'run test:import', 'run debug:smoke')
        for fail_step in ('', *steps):
            with self.subTest(fail_step=fail_step), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'tools').mkdir()
                (root / '.local').mkdir()
                (root / 'bin').mkdir()
                shutil.copyfile(Path(__file__).with_name('gate.sh'), root / 'tools/gate.sh')
                npm = root / 'bin/npm'
                npm.write_text('#!/bin/sh\n'
                               'printf "%s|%s\\n" "$*" "${OPEN_CONTENT_ONLY:-unset}" >> .local/calls\n'
                               '[ "$*" = "$FAIL_STEP" ] && exit 7\n'
                               '[ "$*" = "run test:import" ] && printf "Ran 1 test\\n"\n'
                               'exit 0\n')
                npm.chmod(0o755)
                log = root / '.local/issue-specific.log'
                env = {**os.environ, 'PATH': f'{root}/bin:{os.environ["PATH"]}',
                       'FAIL_STEP': fail_step, 'GATE_LOG': '.local/step.log'}
                env.pop('OPEN_CONTENT_ONLY', None)
                with log.open('w') as output:
                    result = subprocess.run(['bash', str(root / 'tools/gate.sh')],
                                            stdout=output, stderr=subprocess.STDOUT,
                                            env=env,
                                            timeout=20)
                record = json.loads((root / '.local/gate.latest.json').read_text())
                self.assertEqual(record['log'], str(log))
                self.assertLessEqual(record['started'], record['updated'])
                self.assertEqual(result.returncode, 7 if fail_step else 0)
                self.assertEqual(record['status'], f'failed: npm {fail_step}' if fail_step else 'green')
                self.assertEqual((root / '.local/gate.ok').exists(), not bool(fail_step))
                executed = steps[:steps.index(fail_step) + 1] if fail_step else steps
                self.assertEqual((root / '.local/calls').read_text().splitlines(),
                                 [f'{step}|{"1" if step == "run build" else "unset"}' for step in executed])
                for step in executed:
                    self.assertTrue((root / f'.local/step-npm-{step.replace(" ", "-")}.log').is_file())
                self.assertIn('elapsed ', log.read_text())


if __name__ == '__main__':
    unittest.main()
