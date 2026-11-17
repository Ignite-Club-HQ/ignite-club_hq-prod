"""Offline lossless repackaging; never connects to a canister or changes decoded Wasm."""
import gzip
import hashlib
import io
from pathlib import PurePosixPath
import tarfile


def compress_program(data):
    import zopfli.gzip
    if not data.startswith(b'\x1f\x8b'):
        raise ValueError('Expected an already compressed reviewed program')
    raw = gzip.decompress(data)
    if not raw.startswith(b'\0asm'):
        raise ValueError('Not a Wasm program')
    candidate = zopfli.gzip.compress(raw, numiterations=1)
    result = candidate if len(candidate) < len(data) else data
    if gzip.decompress(result) != raw:
        raise ValueError('Decoded program changed')
    return result


def optimize_png(data):
    from PIL import Image
    original = Image.open(io.BytesIO(data))
    # Preserve animated, palette, transparency and color-profile semantics untouched.
    if original.mode not in ('RGB', 'RGBA') or original.info or getattr(original, 'n_frames', 1) != 1:
        return data
    output = io.BytesIO()
    original.save(output, format='PNG', optimize=True, compress_level=9)
    candidate = output.getvalue()
    decoded = Image.open(io.BytesIO(candidate))
    if decoded.size != original.size or decoded.mode != original.mode or decoded.tobytes() != original.tobytes():
        raise ValueError('Image pixels changed')
    return candidate if len(candidate) < len(data) else data


def load_archive(path):
    files = {}
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or '.git' in name.parts or member.issym() or member.islnk():
                raise ValueError('Unsafe archive entry')
            if member.isfile():
                if member.name in files:
                    raise ValueError('Duplicate archive entry')
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError('Unreadable archive entry')
                files[member.name] = stream.read()
    return files


def verify(original, optimized, before, after):
    if set(original) != set(optimized):
        raise ValueError('Inventory changed')
    if len(after['canisters']) != 19 or {c['name'] for c in after['canisters']} != {c['name'] for c in before['canisters']}:
        raise ValueError('Expected the same nineteen services')
    for old, new in zip(before['canisters'], after['canisters']):
        old_step = old['build']['steps'][0]
        step = new['build']['steps'][0]
        path = step['path']
        expected = hashlib.sha256(optimized[path]).hexdigest()
        if step['sha256'] != expected or old_step['sha256'] != hashlib.sha256(original[path]).hexdigest():
            raise ValueError('Program pin mismatch')
        if gzip.decompress(original[path]) != gzip.decompress(optimized[path]):
            raise ValueError('Decoded program changed')
        # Only the transport-byte fingerprint may change in the manifest.
        clone = dict(step, sha256=old_step['sha256'])
        if clone != old_step:
            raise ValueError('Build behavior changed')
        for key in set(old) | set(new):
            if key != 'build' and old.get(key) != new.get(key):
                raise ValueError('Settings or setup changed')
    for key in set(before) | set(after):
        if key != 'canisters' and before.get(key) != after.get(key):
            raise ValueError('Environment changed')
    programs = {c['build']['steps'][0]['path'] for c in after['canisters']}
    for path in original:
        if path in programs or path == 'icp.yaml' or path.endswith('.png'):
            continue
        if original[path] != optimized[path]:
            raise ValueError('Website or plugin changed')