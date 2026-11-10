"""Check the generated Android adapter integration without changing a device."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('icpforeground', ROOT / 'scripts/configure-icp-foreground-push.py')
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Cannot load ICP foreground helper')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ForegroundScaffoldTests(unittest.TestCase):
    def test_install_is_idempotent_and_preserves_existing_registration(self):
        with tempfile.TemporaryDirectory() as tmp:
            frontend = Path(tmp)
            activity = frontend / 'android/app/src/main/java/app/lovable/igniteteamhub/MainActivity.java'
            activity.parent.mkdir(parents=True)
            activity.write_text('package app.lovable.igniteteamhub;\nclass MainActivity { void onCreate() {\nregisterPlugin(StatusBarBackdropPlugin.class);\nsuper.onCreate();\n}}')
            (frontend / 'native/android').mkdir(parents=True)
            shutil.copyfile(ROOT / 'frontend/native/android/IcpForegroundPushPlugin.java', frontend / 'native/android/IcpForegroundPushPlugin.java')
            MODULE.configure(frontend)
            MODULE.configure(frontend)
            self.assertEqual(activity.read_text().count('registerPlugin(IcpForegroundPushPlugin.class);'), 1)
            self.assertIn('registerPlugin(StatusBarBackdropPlugin.class);', activity.read_text())
            self.assertTrue(activity.with_name('IcpForegroundPushPlugin.java').read_text().startswith('package app.lovable.igniteteamhub;'))

    def test_unknown_scaffold_fails_without_mutating_activity(self):
        with tempfile.TemporaryDirectory() as tmp:
            frontend = Path(tmp)
            activity = frontend / 'android/app/src/main/java/example/MainActivity.java'
            activity.parent.mkdir(parents=True)
            activity.write_text('unknown scaffold')
            with self.assertRaises(RuntimeError):
                MODULE.configure(frontend)
            self.assertEqual(activity.read_text(), 'unknown scaffold')


if __name__ == '__main__':
    unittest.main()