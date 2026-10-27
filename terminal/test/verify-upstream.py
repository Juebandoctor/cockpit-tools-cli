#!/usr/bin/env python3
"""Check all files from the downloaded upstream ZIP against the preserved source tree."""
import argparse
import json
from pathlib import Path
import zipfile
import zlib

p = argparse.ArgumentParser()
p.add_argument('archive')
p.add_argument('checkout')
a = p.parse_args()
root = Path(a.checkout)
checked = 0
errors = []
with zipfile.ZipFile(a.archive) as archive:
    commit = archive.comment.decode()
    for info in archive.infolist():
        if info.is_dir():
            continue
        relative = Path(*Path(info.filename).parts[1:])
        file = root / relative
        if not file.is_file():
            errors.append(str(relative) + ': missing')
            continue
        if zlib.crc32(file.read_bytes()) != info.CRC:
            errors.append(str(relative) + ': modified')
        checked += 1
report = {'ok': not errors, 'upstreamCommit': commit, 'upstreamFilesChecked': checked, 'errors': errors}
out = root / 'terminal' / '.test-artifacts' / 'upstream-preservation.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report, indent=2))
raise SystemExit(1 if errors else 0)
