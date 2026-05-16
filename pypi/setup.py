"""
Setup script that downloads the correct prebuilt binary during install.
"""

import os
import platform
import shutil
import stat
import sys
import tarfile
import zipfile
from io import BytesIO
from urllib.request import urlopen, Request
from urllib.error import URLError

from setuptools import setup
from setuptools.command.build_py import build_py

REPO = "av/skilled"
BINARY = "skilled"
VERSION = "0.3.0"

PLATFORM_MAP = {
    "Linux": "linux",
    "Darwin": "darwin",
    "Windows": "windows",
}

ARCH_MAP = {
    "x86_64": "amd64",
    "AMD64": "amd64",
    "aarch64": "arm64",
    "arm64": "arm64",
}


def get_artifact_info():
    system = platform.system()
    machine = platform.machine()

    plat = PLATFORM_MAP.get(system)
    if not plat:
        raise RuntimeError(
            f"Unsupported platform: {system}. "
            f"Supported: {', '.join(PLATFORM_MAP.keys())}"
        )

    arch = ARCH_MAP.get(machine)
    if not arch:
        raise RuntimeError(
            f"Unsupported architecture: {machine}. "
            f"Supported: {', '.join(ARCH_MAP.keys())}"
        )

    if plat == "darwin" and arch == "amd64":
        raise RuntimeError(
            "Intel Mac (darwin-amd64) prebuilt binaries are not available.\n"
            "Options:\n"
            "  - Use an Apple Silicon Mac (arm64)\n"
            "  - Install from source: git clone https://github.com/av/skilled && cd skilled && bun run build"
        )

    artifact = f"{BINARY}-{plat}-{arch}"
    ext = "zip" if plat == "windows" else "tar.gz"
    return artifact, ext, plat


def download_binary(dest_dir):
    artifact, ext, plat = get_artifact_info()
    tag = f"v{VERSION}"
    url = f"https://github.com/{REPO}/releases/download/{tag}/{artifact}.{ext}"

    print(f"Downloading {BINARY} {tag} ({artifact})...")

    try:
        req = Request(url, headers={"User-Agent": "skilled-pypi"})
        response = urlopen(req, timeout=60)
        data = response.read()
    except (URLError, OSError) as e:
        print(
            f"Warning: Could not download {BINARY} binary: {e}\n"
            f"URL: {url}\n"
            "You can install manually: https://github.com/av/skilled#installation",
            file=sys.stderr,
        )
        return

    os.makedirs(dest_dir, exist_ok=True)

    # Extract into a temp directory first to avoid leaving corrupted binaries
    # on partial failure (corrupt archive, disk full, etc.).
    tmp_dir = dest_dir + ".tmp"
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir)
    os.makedirs(tmp_dir)

    try:
        if ext == "zip":
            with zipfile.ZipFile(BytesIO(data)) as zf:
                zf.extractall(tmp_dir)
        else:
            with tarfile.open(fileobj=BytesIO(data), mode="r:gz") as tf:
                tf.extractall(tmp_dir)

        # Move extracted files to final destination only after successful extraction
        for name in os.listdir(tmp_dir):
            src = os.path.join(tmp_dir, name)
            dst = os.path.join(dest_dir, name)
            if os.path.exists(dst):
                os.remove(dst)
            os.rename(src, dst)
    finally:
        # Clean up temp directory regardless of success/failure
        if os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir)

    binary_name = f"{BINARY}.exe" if plat == "windows" else BINARY
    binary_path = os.path.join(dest_dir, binary_name)
    if os.path.isfile(binary_path) and plat != "windows":
        st = os.stat(binary_path)
        os.chmod(binary_path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    index_name = f"{BINARY}-index.exe" if plat == "windows" else f"{BINARY}-index"
    index_path = os.path.join(dest_dir, index_name)
    if os.path.isfile(index_path) and plat != "windows":
        st = os.stat(index_path)
        os.chmod(index_path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    print(f"Successfully installed {BINARY} binary to {binary_path}")
    if os.path.isfile(index_path):
        print(f"Successfully installed {BINARY}-index to {index_path}")


class BuildPyWithBinary(build_py):
    def run(self):
        super().run()
        bin_dir = os.path.join(self.build_lib, "skilled_cli", "bin")
        download_binary(bin_dir)


setup(
    cmdclass={"build_py": BuildPyWithBinary},
    packages=["skilled_cli"],
    package_data={"skilled_cli": ["bin/*"]},
)
