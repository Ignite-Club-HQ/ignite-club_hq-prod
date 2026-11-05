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


if __name__ == "__main__":
    unittest.main()