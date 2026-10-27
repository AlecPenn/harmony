"""One bounded native owner operation. No network, credential export or file writes."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".runtime" / "owner"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctypes
import json
import logging
import os
import threading
logging.disable(logging.CRITICAL)
from verification import ORIGIN, parse_request, run
from fido2.client import DefaultClientDataCollector
from fido2.client.windows import WindowsClient

def main():
    if sys.argv[1:] == ["--probe"]:
        print(json.dumps({"available": WindowsClient.is_available()}), flush=True)
        return
    if sys.argv[1:]:
        raise ValueError("Invalid arguments")
    raw = sys.stdin.buffer.readline(24577)
    if len(raw) > 24576 or not raw.endswith(b"\n"):
        raise ValueError("Invalid request frame")
    value = parse_request(json.loads(raw.decode("utf-8")))
    # Only the spawning application's own live window may own native verification UI.
    user32 = ctypes.WinDLL("user32", winmode=0x00000800)
    user32.IsWindow.argtypes = [ctypes.c_void_p]
    user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    hwnd = ctypes.c_void_p(int(value["window"]))
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not user32.IsWindow(hwnd) or pid.value != os.getppid():
        raise ValueError("Invalid parent window")
    cancel = threading.Event()
    def watch():
        # EOF or any second frame cancels. The pipe is private to the parent.
        sys.stdin.buffer.readline(32)
        cancel.set()
    threading.Thread(target=watch, daemon=True).start()
    result = run(value, WindowsClient(DefaultClientDataCollector(ORIGIN), handle=hwnd), cancel)
    encoded = json.dumps(result)
    if len(encoded) > 12288:
        raise ValueError("Oversized result")
    print(encoded, flush=True)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"result":"unavailable"}', flush=True)
        sys.exit(1)
