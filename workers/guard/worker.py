"""HARMONY guard worker (JSON lines on stdin/stdout). Computes voice and face prints on request; keeps nothing.

  -> {"type":"ready","version":1,"voice":true,"face":true}
  <- {"type":"voice","id":3,"pcm":"<base64 int16 LE, 16 kHz mono, 0.8-12 s>"}
  -> {"type":"voice","id":3,"embedding":"<base64 float32 x256>"|null,"seconds":2.4,"reason":null}
  <- {"type":"face","id":4,"jpeg":"<base64 JPEG or PNG, up to 1.5 MB>"}
  -> {"type":"face","id":4,"faces":1,"embedding":"<base64 float32 x128>"|null,"live":2.3,"yaw":0.02,...}
  <- {"type":"hands","id":5,"jpeg":"<base64 JPEG, a small camera frame>"}
  -> {"type":"hands","id":5,"hands":[{"joints":[[x,y] x21 as fractions of the frame],"right":true,"conf":0.93}],"aspect":1.33}
  <- {"type":"stop"}
Audio and images are decoded in memory, used once and zeroed. Models load lazily on first use.
"""
import base64, json, os, runpy, sys
from pathlib import Path

os.environ['OMP_NUM_THREADS'] = '1'
os.environ.setdefault('OPENCV_LOG_LEVEL', 'ERROR')
sys.path = [p for p in sys.path if p not in ('', '.')]
guard = runpy.run_path(str(Path(__file__).with_name('guard.py')))
MAX_LINE = 2_200_000


def main():
    import numpy as np
    voice = face = hands = None
    ready_voice = guard['model_path']('voice') is not None
    ready_face = all(guard['model_path'](n) for n in ('face_detector', 'face_recognizer', 'face_liveness'))
    ready_hands = all(guard['model_path'](n) for n in ('hand_palm', 'hand_pose'))

    def emit(value):
        sys.stdout.write(json.dumps(value) + '\n'); sys.stdout.flush()

    emit({'type': 'ready', 'version': 1, 'voice': ready_voice, 'face': ready_face, 'hands': ready_hands})
    while True:
        line = sys.stdin.buffer.readline(MAX_LINE + 1)
        if not line:
            break
        if len(line) > MAX_LINE:
            emit({'type': 'error', 'reason': 'Request too large'}); break
        try:
            message = json.loads(line)
        except ValueError:
            emit({'type': 'error', 'reason': 'Bad request'}); continue
        if message == {'type': 'stop'}:
            break
        kind, rid = message.get('type') if isinstance(message, dict) else None, message.get('id') if isinstance(message, dict) else None
        if not isinstance(rid, int) or not 0 <= rid < 2**31:
            emit({'type': 'error', 'reason': 'Bad request'}); continue
        try:
            if kind == 'voice' and set(message) == {'type', 'id', 'pcm'} and isinstance(message['pcm'], str):
                raw = base64.b64decode(message['pcm'], validate=True)
                if len(raw) % 2 or not guard['MIN_VOICE'] * 2 <= len(raw) <= guard['RATE'] * 12 * 2:
                    emit({'type': 'voice', 'id': rid, 'embedding': None, 'seconds': len(raw) / 32000, 'reason': 'Need about 1 to 12 seconds of speech'}); continue
                samples = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
                if voice is None:
                    voice = guard['VoicePrint'].load()
                    if voice is None:
                        emit({'type': 'voice', 'id': rid, 'embedding': None, 'seconds': 0, 'reason': 'Voice model is not set up'}); continue
                v = voice.embed(samples); samples.fill(0)
                emit({'type': 'voice', 'id': rid, 'embedding': None if v is None else base64.b64encode(v.astype('<f4').tobytes()).decode(),
                      'seconds': round(len(raw) / 32000, 2), 'reason': None if v is not None else 'Too quiet or too short'})
            elif kind == 'face' and set(message) == {'type', 'id', 'jpeg'} and isinstance(message['jpeg'], str):
                import cv2
                data = np.frombuffer(base64.b64decode(message['jpeg'], validate=True), dtype=np.uint8)
                image = cv2.imdecode(data, cv2.IMREAD_COLOR) if 0 < data.size <= 1_600_000 else None
                if image is None:
                    emit({'type': 'face', 'id': rid, 'faces': 0, 'embedding': None, 'reason': 'Unreadable image'}); continue
                if face is None:
                    face = guard['FaceEngine'].load()
                    if face is None:
                        emit({'type': 'face', 'id': rid, 'faces': 0, 'embedding': None, 'reason': 'Face models are not set up'}); continue
                out = face.describe(image); image.fill(0)
                v = out.pop('embedding')
                emit({'type': 'face', 'id': rid, **out, 'embedding': None if v is None else base64.b64encode(v.astype('<f4').tobytes()).decode()})
            elif kind == 'hands' and set(message) == {'type', 'id', 'jpeg'} and isinstance(message['jpeg'], str):
                import cv2
                data = np.frombuffer(base64.b64decode(message['jpeg'], validate=True), dtype=np.uint8)
                image = cv2.imdecode(data, cv2.IMREAD_COLOR) if 0 < data.size <= 400_000 else None
                if image is None:
                    emit({'type': 'hands', 'id': rid, 'hands': [], 'reason': 'Unreadable image'}); continue
                if hands is None:
                    hands = guard['HandEngine'].load()
                    if hands is None:
                        emit({'type': 'hands', 'id': rid, 'hands': [], 'reason': 'Hand models are not set up'}); continue
                out = hands.describe(image); image.fill(0)
                emit({'type': 'hands', 'id': rid, **out})
            else:
                emit({'type': 'error', 'id': rid, 'reason': 'Unknown request'})
        except Exception:
            emit({'type': 'error', 'id': rid, 'reason': 'Guard check failed'})


if __name__ == '__main__':
    main()
