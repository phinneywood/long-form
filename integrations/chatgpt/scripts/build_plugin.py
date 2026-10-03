#!/usr/bin/env python3
"""Build a cloud plugin archive from reviewed repository source."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\Z")


def build(plugin: str, skills: list[str], destination: Path) -> Path:
    if not NAME.fullmatch(plugin) or any(not NAME.fullmatch(name) for name in skills):
        raise ValueError("plugin and skill names must be lowercase hyphenated names")
    manifest_path = ROOT / "plugins" / plugin / "plugin.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("name") != plugin or not VERSION.fullmatch(str(manifest.get("version", ""))):
        raise ValueError("manifest name or semantic version is invalid")
    entries = [("plugin.json", manifest_path)]
    apps_file = manifest.get("extensions", {}).get("com.openai", {}).get("apps")
    if apps_file:
        if apps_file != "./.app.json":
            raise ValueError("app mapping must be ./.app.json")
        apps_path = manifest_path.parent / ".app.json"
        apps = json.loads(apps_path.read_text(encoding="utf-8")).get("apps", {})
        if not apps or any(not isinstance(app, dict) or not re.fullmatch(r"(?:asdk_app_|connector_|templated_apps_)[a-zA-Z0-9_]+", str(app.get("id", ""))) for app in apps.values()):
            raise ValueError("app mapping must reference registered app IDs")
        entries.append((".app.json", apps_path))
    for name in skills:
        source = ROOT / "skills" / name
        if not (source / "SKILL.md").is_file():
            raise ValueError(f"missing skills/{name}/SKILL.md")
        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"symlink not supported: {path}")
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                entries.append((f"skills/{name}/{path.relative_to(source).as_posix()}", path))
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f"{plugin}-{manifest['version']}.zip"
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for archive_name, source in entries:
            info = ZipInfo(archive_name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes())
    print(f"{output}  sha256={hashlib.sha256(output.read_bytes()).hexdigest()}")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugin")
    parser.add_argument("--skills", nargs="+", help="skill folder names; defaults to plugin name")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    try:
        build(args.plugin, args.skills or [args.plugin], args.output)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Cannot build plugin: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
