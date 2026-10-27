"""
Run a Blender build script inside the running Blender, through its MCP add-on's local socket.

    python3 blender/run.py blender/trees.py

The script runs in Blender's Python with this folder on sys.path (so `import lib` works) and can set
`result` to send something back. Start Blender with the MCP add-on's server on (port 9876).
"""

import json
import os
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(path: str) -> dict:
    source = open(path).read()
    prelude = (
        "import sys, importlib\n"
        f"sys.path.insert(0, {HERE!r}) if {HERE!r} not in sys.path else None\n"
        "import lib\nimportlib.reload(lib)\n"
        f"__file__ = {os.path.abspath(path)!r}\n"
    )
    request = {"type": "execute", "code": prelude + source, "strict_json": False}
    with socket.create_connection(("localhost", 9876), timeout=1800) as s:
        s.sendall((json.dumps(request) + "\0").encode())
        buf = b""
        while b"\0" not in buf:
            chunk = s.recv(1 << 20)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf.split(b"\0")[0])


if __name__ == "__main__":
    reply = run(sys.argv[1])
    if reply.get("status") != "ok":
        print(reply.get("message", reply))
        sys.exit(1)
    out = reply.get("result")
    if out:
        print(json.dumps(out, indent=1))
    if reply.get("stdout"):
        print(reply["stdout"])
