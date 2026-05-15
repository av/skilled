"""skilled: TUI dashboard for skill usage stats across AI coding tools."""

import os
import subprocess
import sys


def main():
    binary = os.path.join(os.path.dirname(__file__), "bin", _binary_name())
    if not os.path.isfile(binary):
        print(
            "Error: skilled binary not found. "
            "The postinstall script may have failed.\n"
            "Try reinstalling: pip install --force-reinstall skilled",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        result = subprocess.run([binary] + sys.argv[1:])
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        sys.exit(130)


def _binary_name():
    if sys.platform == "win32":
        return "skilled.exe"
    return "skilled"
