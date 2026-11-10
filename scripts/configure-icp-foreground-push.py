"""Install only the ICP Android presentation adapter after Capacitor sync."""
from pathlib import Path


def configure(frontend: Path):
    java = frontend / 'android/app/src/main/java'
    activities = sorted(java.glob('**/MainActivity.java'))
    if len(activities) != 1:
        raise RuntimeError('Expected one Android MainActivity')
    activity = activities[0]
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


if __name__ == '__main__':
    configure(Path.cwd())