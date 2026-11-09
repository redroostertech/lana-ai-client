"""Helpers for scripts/build-docling-runtime.sh, run with the runtime's own Python (python -I).

  strip <stage> <platform>          remove what docling-serve never needs at run time
  manifest <stage> <json>           write <stage>/lana-runtime.json (what is inside, how to start it)
  pack <stage> <archive>            write a deterministic .tar.gz of <stage>
  check-pyc <stage>                 every .pyc is unchecked-hash (never rewritten after unpacking)
  check <archive>                   list problems an unpacker would refuse (paths, links, types)

Deterministic means the same stage gives the same bytes: entries sorted, owner 0, fixed
times, modes 0755 or 0644, no gzip name or time.
"""

import gzip
import json
import os
import shutil
import stat
import sys
import tarfile

# 2026-01-01T00:00:00Z. Every entry gets this time.
FIXED_MTIME = 1767225600


def site_packages(stage, platform):
    if platform.startswith("windows"):
        return os.path.join(stage, "python", "Lib", "site-packages")
    return os.path.join(stage, "python", "lib", "python3.11", "site-packages")


def stdlib(stage, platform):
    if platform.startswith("windows"):
        return os.path.join(stage, "python", "Lib")
    return os.path.join(stage, "python", "lib", "python3.11")


def rm(path):
    if os.path.islink(path) or os.path.isfile(path):
        os.remove(path)
    elif os.path.isdir(path):
        shutil.rmtree(path)


def strip(stage, platform):
    before = tree_bytes(stage)
    py = os.path.join(stage, "python")
    site = site_packages(stage, platform)
    lib = stdlib(stage, platform)
    # Headers, static libraries, man pages and the stdlib's own tests, IDLE and Tk.
    for rel in ("include", "share"):
        rm(os.path.join(py, rel))
    for rel in ("test", "idlelib", "tkinter", "turtledemo", "ensurepip", "lib2to3/tests"):
        rm(os.path.join(lib, rel))
    for name in os.listdir(lib):
        if name.startswith("config-3.11"):
            rm(os.path.join(lib, name))
    # C++ headers and build helpers torch only needs to compile extensions.
    # torch/bin stays: torch looks for torch_shm_manager there when it loads.
    for rel in ("torch/include", "torch/share/cmake", "torchvision/include"):
        rm(os.path.join(site, rel))
    # pip is for building, not running. Its scripts and every other console script carry the
    # build folder's absolute path, so they would be wrong after the archive moves anyway.
    for name in os.listdir(site):
        if name == "pip" or (name.startswith("pip-") and name.endswith(".dist-info")):
            rm(os.path.join(site, name))
    bindir = os.path.join(py, "Scripts" if platform.startswith("windows") else "bin")
    if os.path.isdir(bindir):
        for name in os.listdir(bindir):
            if platform.startswith("windows") or not name.startswith("python"):
                rm(os.path.join(bindir, name))
    # The removed scripts are listed in their packages' RECORD files with hashes of the build
    # folder's path; drop those rows so RECORD names only what ships (and builds match).
    for root, _dirs, files in os.walk(site):
        if root.endswith(".dist-info") and "RECORD" in files:
            record = os.path.join(root, "RECORD")
            with open(record, encoding="utf-8") as fh:
                rows = fh.read().splitlines(keepends=True)
            kept = [r for r in rows if os.path.lexists(os.path.normpath(os.path.join(site, r.split(",", 1)[0])))
                    or not r.split(",", 1)[0].startswith("..")]
            if kept != rows:
                with open(record, "w", encoding="utf-8") as fh:
                    fh.writelines(kept)
    # Byte code is compiled again below with fixed hashes; test folders and static archives go.
    for root, dirs, files in os.walk(py, topdown=True):
        for d in list(dirs):
            if d == "__pycache__" or (d == "tests" and root.startswith(site)):
                rm(os.path.join(root, d))
                dirs.remove(d)
        for f in files:
            if f.endswith((".a", ".lib", ".pdb")) and root.startswith(site):
                rm(os.path.join(root, f))
    after = tree_bytes(stage)
    print(f"stripped {(before - after) / 1048576:.0f} MB, {after / 1048576:.0f} MB left")


def tree_bytes(stage):
    total = 0
    for root, _dirs, files in os.walk(stage):
        for f in files:
            p = os.path.join(root, f)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    return total


def manifest(stage, spec_json):
    spec = json.loads(spec_json)
    from importlib import metadata
    packages = {}
    for dist in metadata.distributions(path=[site_packages(stage, spec["platform"])]):
        packages[dist.metadata["Name"].lower().replace("_", "-")] = dist.version
    spec["packages"] = dict(sorted(packages.items()))
    with open(os.path.join(stage, "lana-runtime.json"), "w", encoding="utf-8") as fh:
        json.dump(spec, fh, indent=2, sort_keys=True)
        fh.write("\n")


def entries(stage):
    out = []
    for root, dirs, files in os.walk(stage):
        dirs.sort()
        for name in dirs + sorted(files):
            full = os.path.join(root, name)
            out.append((os.path.relpath(full, stage).replace(os.sep, "/"), full))
    out.sort(key=lambda item: item[0])
    return out


def pack(stage, archive):
    files = 0
    unpacked = 0
    with open(archive, "wb") as out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0, compresslevel=9) as gz:
            with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
                for rel, full in entries(stage):
                    info = tar.gettarinfo(full, arcname=rel)
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mtime = FIXED_MTIME
                    info.pax_headers = {}
                    if info.issym():
                        info.mode = 0o777
                        tar.addfile(info)
                    elif info.isdir():
                        info.mode = 0o755
                        tar.addfile(info)
                    elif info.isfile():
                        executable = os.stat(full).st_mode & stat.S_IXUSR
                        info.mode = 0o755 if executable else 0o644
                        with open(full, "rb") as fh:
                            tar.addfile(info, fh)
                        files += 1
                        unpacked += info.size
                    else:
                        raise SystemExit(f"refusing to pack {rel}: not a file, folder or link")
    print(json.dumps({"files": files, "unpackedBytes": unpacked}))


def check_pyc(stage):
    """Every .pyc must be unchecked-hash (flags 1): Python then never compares it with the source
    file's time, so it is never rewritten after the archive unpacks with new file times."""
    bad = []
    for root, _dirs, files in os.walk(stage):
        for f in files:
            if f.endswith(".pyc"):
                with open(os.path.join(root, f), "rb") as fh:
                    if fh.read(8)[4:8] != b"\x01\x00\x00\x00":
                        bad.append(os.path.relpath(os.path.join(root, f), stage))
    for b in bad[:20]:
        print(f"not hash checked: {b}")
    if bad:
        raise SystemExit(f"{len(bad)} byte code files would be rewritten after unpacking")
    print("byte code check ok")


def check(archive):
    problems = []
    with tarfile.open(archive, "r:gz") as tar:
        for m in tar:
            name = m.name
            parts = name.split("/")
            if name.startswith("/") or ".." in parts or "\\" in name:
                problems.append(f"path {name}")
            if m.islnk() or not (m.isfile() or m.isdir() or m.issym()):
                problems.append(f"type {name}")
            if m.issym() and (m.linkname.startswith("/") or ".." in m.linkname.split("/")):
                problems.append(f"link {name} -> {m.linkname}")
    for p in problems:
        print(p)
    if problems:
        raise SystemExit(1)
    print("archive check ok")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "strip":
        strip(sys.argv[2], sys.argv[3])
    elif cmd == "manifest":
        manifest(sys.argv[2], sys.argv[3])
    elif cmd == "pack":
        pack(sys.argv[2], sys.argv[3])
    elif cmd == "check-pyc":
        check_pyc(sys.argv[2])
    elif cmd == "check":
        check(sys.argv[2])
    else:
        raise SystemExit(f"unknown command {cmd}")
