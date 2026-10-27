"""Lifecycle probe only. No audio, network, identity or user data access."""
import json
import sys

print(json.dumps({"type": "ready", "protocol": 1}), flush=True)
for line in sys.stdin:
    try:
        message = json.loads(line)
        if message == {"type": "ping"}:
            print(json.dumps({"type": "pong", "protocol": 1}), flush=True)
        elif message == {"type": "stop"}:
            break
    except (ValueError, TypeError):
        pass
