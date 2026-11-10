"""Install only the ICP Android presentation adapter after Capacitor sync."""
from pathlib import Path


def configure(frontend: Path):
    java = frontend / 'android/app/src/main/java'
    activities = sorted(java.glob('**/MainActivity.java'))
    if len(activities) != 1:
        raise RuntimeError('Expected one Android MainActivity')
    activity = activities[0]
    # Firebase is an implementation dependency of the existing plugin: its
    # classes are present at runtime but hidden from app Java compilation.
    # Expose only that same artifact/version to the adapter's compile classpath.
    gradle = frontend / 'android/app/build.gradle'
    gradle_source = gradle.read_text()
    dependency = 'compileOnly "com.google.firebase:firebase-messaging:${project(\':capacitor-push-notifications\').ext.firebaseMessagingVersion}"'
    evaluation = "evaluationDependsOn(':capacitor-push-notifications')"
    anchor = 'dependencies {'
    if dependency not in gradle_source:
        if anchor not in gradle_source:
            raise RuntimeError('Expected Android app dependencies block')
        gradle_source = gradle_source.replace(anchor, anchor + '\n    ' + dependency, 1)
        if evaluation not in gradle_source:
            gradle_source = gradle_source.replace(anchor, evaluation + '\n' + anchor, 1)
    source = activity.read_text()
    registration = 'registerPlugin(IcpForegroundPushPlugin.class);'
    if registration not in source:
        anchor = 'registerPlugin(StatusBarBackdropPlugin.class);'
        if anchor not in source:
            raise RuntimeError('Run Android status-bar configuration first')
        activity.write_text(source.replace(anchor, anchor + '\n        ' + registration, 1))
    package = '.'.join(activity.parent.relative_to(java).parts)
    plugin = (frontend / 'native/android/IcpForegroundPushPlugin.java').read_text()
    activity.with_name('IcpForegroundPushPlugin.java').write_text(
        plugin.replace('package com.igniteclubhq.app;', f'package {package};', 1))
    if gradle_source != gradle.read_text():
        gradle.write_text(gradle_source)


if __name__ == '__main__':
    configure(Path.cwd())