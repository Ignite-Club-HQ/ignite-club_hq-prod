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

    def test_pristine_capacitor_android_scaffold_registers_all_native_plugins(self):
        # A clean Capacitor MainActivity has no onCreate() until status-bar
        # configuration generates one. Reproduce that exact starting state.
        spec = importlib.util.spec_from_file_location('statusbar', ROOT / 'scripts/configure-android-status-bar.py')
        statusbar = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(statusbar)
        spec = importlib.util.spec_from_file_location('foregroundpush', ROOT / 'scripts/configure-icp-foreground-push.py')
        push = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(push)

        with tempfile.TemporaryDirectory() as directory:
            front = Path(directory)
            def write(path, value):
                p = front / path; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(value); return p
            shutil.copytree(ROOT / 'frontend/native', front / 'native')
            activity = write('android/app/src/main/java/app/lovable/igniteteamhub/MainActivity.java',
                             'package app.lovable.igniteteamhub;\nimport com.getcapacitor.BridgeActivity;\n'
                             'public class MainActivity extends BridgeActivity {}\n')
            write('android/app/src/main/res/values/styles.xml',
                  '<resources><style name="AppTheme"/><style name="AppTheme.NoActionBar"/>'
                  '<style name="AppTheme.NoActionBarLaunch"/></resources>')
            write('android/app/src/main/assets/capacitor.plugins.json', '[{"classpath":"FileOpenerPlugin"}]')
            write('android/app/src/main/AndroidManifest.xml', '<manifest><application /></manifest>')
            write('android/app/build.gradle', 'dependencies {\n}\n')
            write('node_modules/@capacitor-community/file-opener/android/src/main/java/com/ryltsov/alex/plugins/file/opener/FileOpenerPlugin.java',
                  'if (openWithDefault) { }')
            # The status-bar configurator patches Capacitor's installed SystemBars
            # source. Model that upstream file in this isolated scaffold test.
            write('node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java',
                  'getActivity().getWindow().getDecorView().setBackgroundColor(getThemeColor(getContext(), android.R.attr.windowBackground));')
            statusbar.configure(front)
            module.configure(front, 'android')
            push.configure(front)
            content = activity.read_text()
            registrations = [
                'registerPlugin(StatusBarBackdropPlugin.class);',
                'registerPlugin(app.ignite.documents.NativeFileExportPlugin.class);',
                'registerPlugin(IcpForegroundPushPlugin.class);',
            ]
            for registration in registrations:
                self.assertEqual(content.count(registration), 1)
                self.assertLess(content.index(registration), content.index('super.onCreate('))
            self.assertIn('compileOnly "com.google.firebase:firebase-messaging:',
                          (front / 'android/app/build.gradle').read_text())
            self.assertTrue((activity.parent / 'IcpForegroundPushPlugin.java').is_file())

    def test_both_codemagic_android_scaffolds_preserve_required_plugin_order(self):
        workflow = (ROOT / 'codemagic.yaml').read_text()
        for name, next_name in [('android-debug', 'android-workflow'), ('android-workflow', 'ios-debug')]:
            section = workflow.split('  ' + name + ':', 1)[1].split('  ' + next_name + ':', 1)[0]
            commands = [
                'python3 ../scripts/configure-android-status-bar.py',
                'python3 ../scripts/configure-native-documents.py android',
                'python3 ../scripts/configure-icp-foreground-push.py',
            ]
            for command in commands:
                self.assertEqual(section.count(command), 1, name + ' must configure each plugin once')
            self.assertTrue(all(section.index(a) < section.index(b) for a, b in zip(commands, commands[1:])),
                            name + ' must create the Android onCreate hook before document registration')

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