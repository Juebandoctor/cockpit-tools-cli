#!/usr/bin/env python3
"""Build an offline pure-JS portable ZIP or tar.gz. Node is still required."""
import argparse
import json
from pathlib import Path
import zipfile
import tarfile

p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
if not (root / 'node_modules' / 'smol-toml' / 'package.json').is_file():
    raise SystemExit('Run npm ci before building the portable package.')
out = Path(a.output).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
files = []
for directory in ['bin', 'src', 'node_modules']:
    files.extend(file for file in (root / directory).rglob('*') if file.is_file())
files.extend(root / name for name in ['package.json', 'package-lock.json', 'README.zh-CN.md', 'NOTICE.md'])
if out.name.endswith('.tar.gz'):
    with tarfile.open(out, 'w:gz') as archive:
        for file in sorted(files):
            archive.add(file, arcname=str(Path('cockpit-tools-terminal') / file.relative_to(root)), recursive=False)
elif out.suffix == '.zip':
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(files):
            archive.write(file, Path('cockpit-tools-terminal') / file.relative_to(root))
else:
    raise SystemExit('Output must end in .zip or .tar.gz')
print(json.dumps({'ok': True, 'archive': str(out), 'files': len(files), 'bytes': out.stat().st_size, 'requires': 'Node.js >=22.16.0; no npm install required'}, ensure_ascii=False))
