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
        for fail_step in ('', 'run build'):
            with self.subTest(fail_step=fail_step), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'tools').mkdir()
                (root / '.local').mkdir()
                (root / 'bin').mkdir()
                shutil.copyfile(Path(__file__).with_name('gate.sh'), root / 'tools/gate.sh')
                npm = root / 'bin/npm'
                npm.write_text('#!/bin/sh\n'
                               '[ "$*" = "$FAIL_STEP" ] && exit 7\n'
                               '[ "$*" = "run test:import" ] && printf "Ran 1 test\\n"\n'
                               'exit 0\n')
                npm.chmod(0o755)
                log = root / '.local/issue-specific.log'
                with log.open('w') as output:
                    result = subprocess.run(['bash', str(root / 'tools/gate.sh')],
                                            stdout=output, stderr=subprocess.STDOUT,
                                            env={**os.environ, 'PATH': f'{root}/bin:{os.environ["PATH"]}',
                                                 'FAIL_STEP': fail_step, 'GATE_LOG': '.local/step.log'},
                                            timeout=20)
                record = json.loads((root / '.local/gate.latest.json').read_text())
                self.assertEqual(record['log'], str(log))
                self.assertLessEqual(record['started'], record['updated'])
                self.assertEqual(result.returncode, 7 if fail_step else 0)
                self.assertEqual(record['status'], 'failed: npm run build' if fail_step else 'green')
                self.assertEqual((root / '.local/gate.ok').exists(), not bool(fail_step))


if __name__ == '__main__':
    unittest.main()
