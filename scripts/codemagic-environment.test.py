"""All phone builds must import the production public configuration group."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]


class CodemagicEnvironmentTests(unittest.TestCase):
    def test_every_phone_workflow_imports_production_configuration(self):
        workflows = yaml.safe_load((ROOT / "codemagic.yaml").read_text())["workflows"]
        for name in ("android-debug", "android-workflow", "ios-debug", "ios-workflow"):
            with self.subTest(workflow=name):
                self.assertIn("supabase_prod", workflows[name]["environment"].get("groups", []))


if __name__ == "__main__":
    unittest.main()