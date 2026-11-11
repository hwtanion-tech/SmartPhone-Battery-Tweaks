"""Build a deterministic ModLoader archive, using only project-owned sources."""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src"


def build():
    manifest = json.loads((SOURCE / "boot.json").read_text(encoding="utf-8"))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if manifest["version"] != package["version"]:
        raise ValueError("boot.json and package.json versions must match")
    files = ["boot.json"]
    for key in ("styleFileList", "scriptFileList", "tweeFileList", "imgFileList", "additionFile"):
        files.extend(manifest.get(key, []))
    if len(files) != len(set(files)):
        raise ValueError("Duplicate archive entry")
    contents = {}
    for name in files:
        path = (SOURCE / name).resolve()
        if not path.is_relative_to(SOURCE.resolve()) or not path.is_file():
            raise ValueError(f"Invalid or missing package source: {name}")
        contents[name] = path.read_bytes()
    output = ROOT / "dist" / f"SmartPhone-Battery-Tweaks-{manifest['version']}.mod.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(contents):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, contents[name])
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("Archive CRC verification failed")
    print(output)


if __name__ == "__main__":
    build()
