"""Contract checks for mesh_quality_tools' plain-Python snapshot comparison."""
import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).with_name("mesh_quality_tools.py")
SPEC = importlib.util.spec_from_file_location("atelier_mesh_quality_tools", MODULE_PATH)
TOOLS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOLS)


def snapshot(coordinate_hash="a" * 64, source_hash="b" * 64):
    component = {"count": 3, "sha256": coordinate_hash}
    return {
        "schema": TOOLS.SNAPSHOT_SCHEMA,
        "source": {"name": "model.blend", "sha256": source_hash},
        "rig": None,
        "meshes": {
            "Body": {
                "coordinates": component,
                "topology": {"count": 1, "sha256": "c" * 64},
                "uv": {"UVMap": {"count": 3, "sha256": "d" * 64}},
                "weights": {"status": "not_verified", "reason": "No explicit rig was supplied"},
                "shape_keys": {},
                "material_slots": {"count": 1, "sha256": "e" * 64},
            }
        },
    }


class MeshQualityContractTests(unittest.TestCase):
    def test_source_file_hash_alone_is_not_mesh_difference(self):
        result = TOOLS.compare_snapshots(snapshot(source_hash="b" * 64), snapshot(source_hash="f" * 64))
        self.assertTrue(result["equal"])
        self.assertEqual(result["status"], "equal_captured_fields")

    def test_captured_component_change_is_reported(self):
        result = TOOLS.compare_snapshots(snapshot(), snapshot(coordinate_hash="f" * 64))
        self.assertFalse(result["equal"])
        self.assertEqual([row["field"] for row in result["differences"]], ["coordinates"])

    def test_malformed_snapshot_and_unverified_weight_contract_fail_closed(self):
        bad = snapshot()
        bad["meshes"]["Body"]["weights"] = {"status": "captured", "deform_bones": [], "count": 3, "sha256": "not-a-digest"}
        with self.assertRaisesRegex(ValueError, "Invalid deform weight"):
            TOOLS.compare_snapshots(snapshot(), bad)
        with self.assertRaisesRegex(ValueError, "Expected a nonempty"):
            TOOLS.compare_snapshots({}, snapshot())


if __name__ == "__main__":
    unittest.main()
