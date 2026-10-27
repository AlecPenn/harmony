"""Verify explicitly provisioned local Kokoro assets before importing ML dependencies.
The manifest must come from a reviewed installation, not an untrusted model response.
"""
import hashlib,json
from pathlib import Path
FILES={'config.json':1024*1024,'kokoro-v1_0.pth':512*1024*1024,'bf_emma.pt':4*1024*1024}

def verify_assets(directory):
    root=Path(directory)
    if root.is_symlink() or not root.is_dir():raise ValueError('Missing local model')
    root=root.resolve(strict=True)
    manifest=root/'manifest.json'
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size>8192:raise ValueError('Invalid manifest')
    value=json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(value,dict) or set(value)!={'version','files'} or type(value['version']) is not int or value['version']!=1 or not isinstance(value['files'],dict) or set(value['files'])!=set(FILES):raise ValueError('Invalid manifest')
    result={}
    for name,limit in FILES.items():
        digest=value['files'][name]
        if not isinstance(digest,str) or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):raise ValueError('Invalid digest')
        path=root/name
        if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<=limit:raise ValueError('Invalid asset')
        h=hashlib.sha256()
        with path.open('rb') as source:
            count=0
            while block:=source.read(1024*1024):
                count+=len(block)
                if count>limit:raise ValueError('Asset limit exceeded')
                h.update(block)
        if h.hexdigest()!=digest:raise ValueError('Asset digest mismatch')
        result[name]=path
    return result
