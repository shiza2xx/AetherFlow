"""Shared bounded identities for arbitrary agent-defined texture groups."""
import re

BASE_GROUPS = ("head", "hair", "upper_body", "lower_body", "accessories")
MAX_GROUPS = 48


def valid_group_key(value):
    return (isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,47}", value) is not None
            and value not in ("body", "assembled", "rig", "constructor", "prototype", "__proto__")
            and re.fullmatch(r"con|prn|aux|nul|com[1-9]|lpt[1-9]", value) is None)


def group_names(assignments, definitions):
    keys = {row.get("group") for row in assignments}
    if not keys or len(keys) > MAX_GROUPS or not all(valid_group_key(key) for key in keys):
        raise ValueError("Use bounded filesystem-safe texture-group identities.")
    names = {}
    for row in definitions:
        key, name = row.get("key"), row.get("name")
        if (not valid_group_key(key) or key in names or key not in keys or not isinstance(name, str)
                or not name.strip() or len(name) > 120 or any(ord(c) < 32 for c in name)):
            raise ValueError("Group definitions need unique used keys and readable names.")
        names[key] = name.strip()
    if any(key not in BASE_GROUPS and key not in names for key in keys):
        raise ValueError("Each agent-defined group requires a name in groupDefinitions.")
    return names
