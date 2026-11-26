"""Offline fresh DEV handover verification. No network or credential access."""
import gzip
import hashlib
import json
from pathlib import Path
import sys


def verify(root: Path) -> int:
    checks = {}
    for line in (root / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ", 1)
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts or name in checks:
            raise ValueError("Invalid or duplicate checksum entry")
        checks[name] = digest
    files = {str(p.relative_to(root)): p for p in root.rglob("*") if p.is_file()}
    if set(checks) != set(files) - {"SHA256SUMS"}:
        raise ValueError("Checksum inventory differs from complete package")
    for name, digest in checks.items():
        if files[name].is_symlink() or hashlib.sha256(files[name].read_bytes()).hexdigest() != digest:
            raise ValueError("File checksum mismatch: " + name)
        if any(part in {".git", ".jj", "node_modules", "target", "build"} for part in Path(name).parts):
            raise ValueError("Excluded generated or repository files present")
    manifest = json.loads((root / "manifest.json").read_text())
    config = json.loads((root / "config.json").read_text())
    if manifest["environment"] != "opencloud-dev" or config["commissioningMode"] != "fresh-install-admission-only":
        raise ValueError("Exact fresh DEV environment required")
    rows = manifest["canisters"]
    if len(rows) != 32 or len({r["id"] for r in rows}) != 32:
        raise ValueError("Exact 32 distinct DEV targets required")
    expected = set(config["shared"].items())
    expected.update((f'{g["id"]}_{name}', principal) for g in config["groups"] for name, principal in g["canisterIds"].items())
    if {(r["name"], r["id"]) for r in rows} != expected:
        raise ValueError("Manifest targets differ from supplied exact DEV inventory")
    mode = manifest["accountProtectionBuild"]
    if mode["witnessRequired"] or mode["approverKeyRequired"] or mode["recoveryEnabled"] or mode["globalErasureEnabled"]:
        raise ValueError("Initial DEV must not grant recovery or erasure")
    if manifest["executable"] or any(manifest["restrictions"][k] for k in ["createCanisters", "reinstall", "deployProd", "automateCI", "changeControllers", "changeMainnet", "changeSupabase"]):
        raise ValueError("Offline/no-mutation restrictions missing")
    for row in rows:
        packed = (root / row["wasm"]).read_bytes()
        raw = gzip.decompress(packed)
        if not raw.startswith(b"\0asm\x01\0\0\0"):
            raise ValueError("Invalid Wasm module")
        if hashlib.sha256(packed).hexdigest() != row["wasmSha256"] or hashlib.sha256(raw).hexdigest() != row["moduleSha256"]:
            raise ValueError("Manifest module hash differs: " + row["name"])
        if hashlib.sha256((root / row["candid"]).read_bytes()).hexdigest() != row["candidSha256"]:
            raise ValueError("Manifest Candid differs: " + row["name"])
    identity = next(row for row in rows if row["service"] == "identity_access")
    raw = gzip.decompress((root / identity["wasm"]).read_bytes())
    if mode["compileTimeEnv"]["IGNITE_OPENCLOUD_DEV_FIRST_INSTALL"].encode() not in raw:
        raise ValueError("Immutable DEV pins not present in identity Wasm")
    witness = config.get("accountProtection", {}).get("witness")
    if witness and (witness in {r["id"] for r in rows} or witness.encode() in raw):
        raise ValueError("Unused witness became an application dependency")
    asset_inventory = json.loads((root / "frontend-artifacts.json").read_text())
    for asset in asset_inventory["files"]:
        content = (root / "frontend-assets" / asset["path"]).read_bytes()
        if len(content) != asset["bytes"] or hashlib.sha256(content).hexdigest() != asset["sha256"]:
            raise ValueError("Frontend inventory mismatch")
    upload = manifest["frontendUpload"]
    if upload["api"] != ["upload_chunks", "execute_operations"] or upload["legacyAssetAPI"]:
        raise ValueError("Wrong frontend upload API")
    if hashlib.sha256((root / upload["plugin"]).read_bytes()).hexdigest() != upload["pluginSha256"]:
        raise ValueError("Frontend plugin differs")
    return len(checks)


if __name__ == "__main__":
    count = verify(Path(sys.argv[1] if len(sys.argv) > 1 else "."))
    print(f"Verified {count} files, 32 DEV targets and complete first-install artifacts; no deployment performed.")