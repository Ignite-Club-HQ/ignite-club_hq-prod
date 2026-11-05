"""All phone builds must import the production public configuration group."""
from pathlib import Path
import unittest
import re

ROOT = Path(__file__).resolve().parents[1]


class CodemagicEnvironmentTests(unittest.TestCase):
    def test_every_phone_workflow_imports_production_configuration(self):
        source = (ROOT / "codemagic.yaml").read_text()
        for name in ("android-debug", "android-workflow", "ios-debug", "ios-workflow"):
            with self.subTest(workflow=name):
                section = re.search(r"^  " + re.escape(name) + r":\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
                self.assertIsNotNone(section)
                if section is None:
                    continue
                environment = section.group(1).split("    scripts:", 1)[0]
                self.assertRegex(environment, r"(?m)^        - supabase_prod$")

    def test_ios_builds_use_spm_project_not_cocoapods_workspace(self):
        # Capacitor 8 scaffolds iOS with Swift Package Manager (CapApp-SPM):
        # cap add ios creates App.xcodeproj only — no Podfile, no
        # App.xcworkspace. Both iOS workflows must build the project and
        # never run pod install.
        source = (ROOT / "codemagic.yaml").read_text()
        self.assertNotIn("pod install", source)
        self.assertNotIn("App.xcworkspace", source)
        debug = re.search(r"^  ios-debug:\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
        self.assertIsNotNone(debug)
        self.assertIn("-project App.xcodeproj", debug.group(1))
        store = re.search(r"^  ios-workflow:\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
        self.assertIsNotNone(store)
        self.assertIn("XCODE_PROJECT: App.xcodeproj", store.group(1))


if __name__ == "__main__":
    unittest.main()