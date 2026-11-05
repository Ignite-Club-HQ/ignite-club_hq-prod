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

    def test_ios_debug_scaffold_guarantees_workspace(self):
        # cap sync can succeed without running CocoaPods, leaving no
        # App.xcworkspace for the xcodebuild step. The debug scaffold must
        # fall back to an explicit pod install and fail loudly if the
        # workspace is still missing.
        source = (ROOT / "codemagic.yaml").read_text()
        section = re.search(r"^  ios-debug:\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
        self.assertIsNotNone(section)
        scaffold = section.group(1).split("Build for simulator", 1)[0]
        self.assertIn("pod install", scaffold)
        self.assertIn("App.xcworkspace still missing", scaffold)


if __name__ == "__main__":
    unittest.main()