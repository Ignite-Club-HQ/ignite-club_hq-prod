"""Wire explicit document export after Capacitor sync; never deploy or alter data."""
from pathlib import Path
import re
import sys

def configure(frontend: Path, platform: str):
    if platform == 'android':
        activities = list((frontend / 'android/app/src/main/java').glob('**/MainActivity.java'))
        if len(activities) != 1:
            raise RuntimeError('Expected one Android activity')
        activity = activities[0]
        source = activity.read_text()
        registration = 'registerPlugin(app.ignite.documents.NativeFileExportPlugin.class);'
        if registration not in source:
            source, count = re.subn(r'(super\.onCreate\([^;]+;)', registration + '\n        ' + r'\1', source, count=1)
            if count != 1:
                raise RuntimeError('Missing activity creation hook')
        destination = frontend / 'android/app/src/main/java/app/ignite/documents/NativeFileExportPlugin.java'
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text((frontend / 'native/NativeFileExportPlugin.java').read_text())
        activity.write_text(source)
        plugins = (frontend / 'android/app/src/main/assets/capacitor.plugins.json').read_text()
        if 'FileOpenerPlugin' not in plugins:
            raise RuntimeError('FileOpener was not synced for Android')
        # A chooser itself can launch with zero viewers. Detect that before launching it.
        plugin = frontend / 'node_modules/@capacitor-community/file-opener/android/src/main/java/com/ryltsov/alex/plugins/file/opener/FileOpenerPlugin.java'
        source = plugin.read_text()
        anchor = 'if (openWithDefault) {'
        guard = 'if (intent.resolveActivity(getContext().getPackageManager()) == null) { call.reject("No compatible viewer", "8"); return; }'
        if guard not in source:
            if anchor not in source:
                raise RuntimeError('Unexpected FileOpener implementation')
            plugin.write_text(source.replace(anchor, guard + '\n                    ' + anchor))
        manifest = frontend / 'android/app/src/main/AndroidManifest.xml'
        source = manifest.read_text()
        query = '<queries><intent><action android:name="android.intent.action.VIEW"/><data android:mimeType="*/*"/></intent></queries>'
        if query not in source:
            source = source.replace('<application', query + '\n    <application', 1)
            manifest.write_text(source)
    elif platform == 'ios':
        app = frontend / 'ios/App/App'
        delegate = app / 'AppDelegate.swift'
        source = delegate.read_text()
        if '@objc(NativeFileExportPlugin)' not in source:
            delegate.write_text(source + '\n' + (frontend / 'native/NativeFileExportPlugin.swift').read_text())
        storyboard = app / 'Base.lproj/Main.storyboard'
        source = storyboard.read_text().replace('customClass="CAPBridgeViewController"', 'customClass="DocumentBridgeViewController"')
        source = source.replace('customModule="Capacitor"', 'customModule="App"')
        if 'DocumentBridgeViewController' not in source:
            raise RuntimeError('Missing iOS bridge storyboard')
        storyboard.write_text(source)
        packages = (frontend / 'ios/App/CapApp-SPM/Package.swift').read_text()
        if 'FileOpener' not in packages:
            raise RuntimeError('FileOpener was not synced for iOS')
    else:
        raise RuntimeError('Unsupported platform')

if __name__ == '__main__':
    configure(Path(__file__).resolve().parents[1] / 'frontend', sys.argv[1])