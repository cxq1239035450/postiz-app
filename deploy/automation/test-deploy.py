"""Exercise release decisions with fake Docker/SSH-free services; never touch production."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
BASH = os.environ.get('TEST_BASH') or shutil.which('bash')


def posix(path):
    path = str(Path(path).resolve()).replace('\\', '/')
    return '/' + path[0].lower() + path[2:] if os.name == 'nt' else path


class DeployTests(unittest.TestCase):
    def run_case(self, mode='', mounted=False):
        with tempfile.TemporaryDirectory(prefix='deploy-test-') as temporary:
            root = Path(temporary)
            bins = root / 'bin'
            prod = root / 'deploy/production'
            incoming = root / 'incoming/test-release'
            for directory in (bins, prod, incoming):
                directory.mkdir(parents=True)
            (prod / 'compose.yaml').write_text('name: test\nservices: {}\n')
            old_start = prod / 'start.sh'
            old_start.write_text('echo old\n')
            calls = root / 'calls'
            state = root / 'mock-state'
            state.write_text('old')
            docker = r'''#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_CALLS"
if [[ $1 == build ]]; then [[ $TEST_MODE != build-failure ]]; exit; fi
if [[ $1 == inspect ]]; then
  case "$3" in
    *'.Image'*) echo sha256:old ;;
    *'.Mounts'*) echo "$TEST_OLD_START" ;;
    *) if [[ $TEST_MODE == health-failure && $(cat "$TEST_STATE") == new ]]; then echo unhealthy; else echo healthy; fi ;;
  esac
  exit
fi
if [[ $* == *' ps -q '* ]]; then echo test-container; exit; fi
if [[ $* == *' up -d '* ]]; then
  config=''
  while (($#)); do
    if [[ $1 == -f ]]; then config=$2; shift; fi
    shift
  done
  if grep -q sha256:old "$config"; then echo old > "$TEST_STATE"; else echo new > "$TEST_STATE"; fi
fi
'''
            for name, contents in {
                'docker': docker,
                'flock': '#!/usr/bin/env bash\nexit 0\n',
                'sleep': '#!/usr/bin/env bash\nexit 0\n',
                'curl': '#!/usr/bin/env bash\nexit 0\n',
            }.items():
                script = bins / name
                script.write_text(contents, newline='\n')
                script.chmod(0o755)
            if os.name == 'nt':
                # Native Windows Python needs translated paths when invoked from Git Bash.
                script = bins / 'python3'
                script.write_text('''#!/usr/bin/env bash
args=("$@")
args[1]=$(cygpath -w "${args[1]}")
export MSYS2_ARG_CONV_EXCL='*'
exec "$TEST_PYTHON" "${args[@]}"
''', newline='\n')
            config = '''COMPOSE_ENV_FILE=''
HEALTH_ATTEMPTS=2
HEALTH_INTERVAL=0
before_switch() { [[ $TEST_MODE != backup-failure ]]; }
'''
            if mounted:
                config += 'STARTUP_SOURCE=start.sh\nSTARTUP_TARGET=/start.sh\n'
            archive = incoming / 'source.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                for name, content in {'deploy/automation/project.sh': config,
                                      'Dockerfile': 'FROM scratch\n',
                                      'start.sh': 'echo new\n'}.items():
                    data = content.encode()
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    tar.addfile(entry, io.BytesIO(data))
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            if mode == 'checksum-failure':
                digest = '0' * 64
            env = os.environ.copy()
            env.update(TEST_MODE=mode, TEST_CALLS=posix(calls), TEST_STATE=posix(state),
                       TEST_OLD_START=posix(old_start), TEST_PYTHON=posix(sys.executable))
            # Set PATH inside bash to avoid Windows semicolon PATH conversion ambiguity.
            result = subprocess.run([BASH, '-c',
                'export PATH="$1:$PATH"; exec bash "$2" "$3" test-release "$4" https://example.com',
                'test', posix(bins), posix(HERE / 'deploy.sh'), posix(root), digest],
                env=env, text=True, capture_output=True, timeout=30)
            log = calls.read_text() if calls.exists() else ''
            active = root / '.deploy-state/active.json'
            active_config = json.loads(active.read_text()) if active.exists() else None
            return result, log, active_config

    def test_success_generic(self):
        result, log, active = self.run_case()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(active['services']['app']['image'], 'app-release:test-release')
        self.assertNotIn('volumes', active['services']['app'])
        self.assertEqual(log.count(' up -d '), 1)

    def test_success_startup_mount(self):
        result, _, active = self.run_case(mounted=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(active['services']['app']['volumes'][0]['target'], '/start.sh')

    def test_failures_before_switch_keep_old_app(self):
        for failure in ('build-failure', 'backup-failure', 'checksum-failure'):
            with self.subTest(failure=failure):
                result, log, active = self.run_case(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(' up -d ', log)
                self.assertIsNone(active)

    def test_failed_health_restores_previous_image(self):
        result, log, active = self.run_case('health-failure', mounted=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log.count(' up -d '), 2, result.stdout + result.stderr)
        self.assertEqual(active['services']['app']['image'], 'sha256:old')
        self.assertIn('Previous application restored', result.stdout)


if __name__ == '__main__':
    unittest.main()
