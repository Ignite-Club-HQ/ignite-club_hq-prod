import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('documents', ROOT / 'scripts/configure-native-documents.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DocumentWiring(unittest.TestCase):
    def test_android_registration_and_viewer_guard_are_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            front = Path(directory)
            def write(path, value):
                p = front / path; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(value); return p
            shutil.copytree(ROOT / 'frontend/native', front / 'native')
            activity = write('android/app/src/main/java/example/MainActivity.java', 'class MainActivity { void onCreate() { super.onCreate(state); } }')
            write('android/app/src/main/assets/capacitor.plugins.json', '[{"classpath":"FileOpenerPlugin"}]')
            manifest = write('android/app/src/main/AndroidManifest.xml', '<manifest><application /></manifest>')
            plugin = write('node_modules/@capacitor-community/file-opener/android/src/main/java/com/ryltsov/alex/plugins/file/opener/FileOpenerPlugin.java', 'if (openWithDefault) { }')
            module.configure(front, 'android'); module.configure(front, 'android')
            self.assertEqual(activity.read_text().count('registerPlugin('), 1)
            self.assertEqual(manifest.read_text().count('<queries>'), 1)
            self.assertEqual(plugin.read_text().count('resolveActivity'), 1)
            self.assertIn('ACTION_CREATE_DOCUMENT', (front / 'native/NativeFileExportPlugin.java').read_text())

    def test_ios_registration_and_export_are_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            front = Path(directory)
            shutil.copytree(ROOT / 'frontend/native', front / 'native')
            app = front / 'ios/App/App'; (app / 'Base.lproj').mkdir(parents=True)
            (app / 'AppDelegate.swift').write_text('import Capacitor\n')
            storyboard = app / 'Base.lproj/Main.storyboard'
            storyboard.write_text('<viewController customClass="CAPBridgeViewController" customModule="Capacitor"/>')
            package = front / 'ios/App/CapApp-SPM/Package.swift'; package.parent.mkdir(parents=True); package.write_text('FileOpenerPlugin')
            module.configure(front, 'ios'); module.configure(front, 'ios')
            self.assertEqual((app / 'AppDelegate.swift').read_text().count('@objc(NativeFileExportPlugin)'), 1)
            self.assertIn('DocumentBridgeViewController', storyboard.read_text())
            self.assertIn('forExporting', (app / 'AppDelegate.swift').read_text())
            self.assertIn('registerPluginInstance', (app / 'AppDelegate.swift').read_text())

if __name__ == '__main__': unittest.main()