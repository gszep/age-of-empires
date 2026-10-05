"""tools/gate.sh is only a compatibility entrypoint for the owned checkpoint.

Receipt/stamp behaviour lives in tools/verify.mjs and is covered by
tools/verify.test.ts; this keeps hooks/operators calling gate.sh honest.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class GateWrapperTest(unittest.TestCase):
    def test_delegates_to_owned_verification_and_keeps_its_status(self):
        for code in (0, 7):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'tools').mkdir()
                (root / 'bin').mkdir()
                shutil.copyfile(Path(__file__).with_name('gate.sh'), root / 'tools/gate.sh')
                npm = root / 'bin/npm'
                npm.write_text('#!/bin/sh\nprintf "%s|%s\\n" "$PWD" "$*" > calls\nexit "$CODE"\n')
                npm.chmod(0o755)
                env = {**os.environ, 'PATH': f'{root}/bin:{os.environ["PATH"]}', 'CODE': str(code)}
                result = subprocess.run(['bash', 'gate.sh'], cwd=root / 'tools', env=env, timeout=20)
                self.assertEqual(result.returncode, code)
                self.assertEqual((root / 'calls').read_text().strip(), f'{root}|run verify:owned')


if __name__ == '__main__':
    unittest.main()
