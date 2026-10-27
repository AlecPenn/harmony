# Parakeet speech recognition notice

HARMONY can use **Parakeet TDT 0.6B v2** by NVIDIA for local English speech recognition in conversation mode. The model is licensed under **Creative Commons Attribution 4.0 (CC-BY-4.0)**: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2. The int8 ONNX conversion is by istupakov (https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx). It runs through **onnx-asr** 0.12.0 (MIT, https://github.com/istupakov/onnx-asr).

The model files are not bundled. They are downloaded on the user's explicit request (`scripts/benchmark-stt.py`) into the ignored `data/models/stt-candidates/` directory, and HARMONY verifies them against `docs/STT-PARAKEET.json` before use. Attribution: "Parakeet TDT 0.6B v2 by NVIDIA, CC-BY-4.0."
