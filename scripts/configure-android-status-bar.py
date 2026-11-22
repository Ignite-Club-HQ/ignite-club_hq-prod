"""Configure generated Android projects without changing inset/keyboard ownership."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET


def preserve_system_bar_backdrop(source: str) -> str:
    """SystemBars owns icon/inset state, not the app's window background.

    Capacitor 8 resets it to the static light Activity theme on every style
    call/configuration change. JS repainting afterwards crosses bridge/UI
    frames, so even correct final ordering still exposes a white frame.
    Refuse unfamiliar upstream source rather than patching it broadly.
    """
    reset = "getActivity().getWindow().getDecorView().setBackgroundColor(getThemeColor(getContext(), android.R.attr.windowBackground));"
    marker = "// Ignite: window backdrop is owned by StatusBarBackdrop, not SystemBars."
    if marker in source and reset not in source:
        return source
    if source.count(reset) != 1 or marker in source:
        raise RuntimeError("Unexpected Capacitor SystemBars backdrop implementation; review before building")
    return source.replace(reset, marker, 1)


def configure(frontend: Path):
    system_bars = frontend / "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java"
    # Both generated Android builds compile this shared dependency. Do not
    # alter insets, keyboard callbacks, icon setters or navigation-bar flags.
    system_bars.write_text(preserve_system_bar_backdrop(system_bars.read_text()))
    styles_path = frontend / "android/app/src/main/res/values/styles.xml"
    tree = ET.parse(styles_path)
    # NoActionBar does NOT inherit AppTheme; launch uses a third theme.
    for style in tree.getroot().findall("style"):
        if style.get("name") not in {"AppTheme", "AppTheme.NoActionBar", "AppTheme.NoActionBarLaunch"}:
            continue
        for name, value in {
            "android:windowBackground": "#f5f7f6",
            "android:statusBarColor": "#f5f7f6",
            "android:windowLightStatusBar": "true",
        }.items():
            item = next((i for i in style.findall("item") if i.get("name") == name), None)
            if item is None:
                item = ET.SubElement(style, "item", {"name": name})
            item.text = value
    tree.write(styles_path, encoding="utf-8", xml_declaration=True)

    # Package follows capacitor appId (prod: app.lovable.igniteteamhub).
    found = sorted((frontend / "android/app/src/main/java").glob("**/MainActivity.java"))
    if len(found) != 1:
        raise RuntimeError(f"Expected one MainActivity.java, found {len(found)}")
    activity = found[0]
    package = ".".join(activity.parent.relative_to(frontend / "android/app/src/main/java").parts)
    source = activity.read_text()
    registration = "registerPlugin(StatusBarBackdropPlugin.class);"
    if registration not in source:
        # Scaffold is deliberately recreated in CI; fail rather than silently
        # omit registration if a future Capacitor template changes.
        template = "public class MainActivity extends BridgeActivity {}"
        if template not in source:
            raise RuntimeError("Unexpected MainActivity template; backdrop plugin not registered")
        source = source.replace(template, """public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(StatusBarBackdropPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(android.graphics.Color.parseColor("#f5f7f6"));
    }
}""")
        activity.write_text(source)
    plugin = (frontend / "native/android/StatusBarBackdropPlugin.java").read_text()
    plugin = plugin.replace("package com.igniteclubhq.app;", f"package {package};", 1)
    activity.with_name("StatusBarBackdropPlugin.java").write_text(plugin)


if __name__ == "__main__":
    configure(Path.cwd())