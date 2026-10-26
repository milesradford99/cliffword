# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["kokoro-onnx==0.6.1", "soundfile==0.13.1"]
# ///
"""Offline audio authoring worker; invoked by npm run audio, never by the app."""
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.request import urlopen

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ASSETS = {
    "kokoro-v1.0.onnx": "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
SETTINGS = {"model": "Kokoro-82M-v1.0", "engine": "kokoro-onnx==0.6.1", "voice": "af_heart", "lang": "en-us", "speed": 0.9, "sampleRate": 24000}


def asset(cache, name):
    path = cache / name
    if not path.exists():
        print(f"Downloading {name} (one time; no book text is uploaded)", flush=True)
        temp = path.with_suffix(".download")
        try:
            with urlopen(RELEASE + name, timeout=60) as source, temp.open("wb") as dest:
                while chunk := source.read(1024 * 1024):
                    dest.write(chunk)
            if hashlib.sha256(temp.read_bytes()).hexdigest() != ASSETS[name]:
                raise ValueError(f"Checksum mismatch: {name}")
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)
    if hashlib.sha256(path.read_bytes()).hexdigest() != ASSETS[name]:
        raise ValueError(f"Checksum mismatch: {path}; remove it and retry")
    return str(path)


def main():
    request = json.load(sys.stdin)
    cache = Path(os.environ.get("CLIFFWORD_TTS_MODELS", Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "cliffword" / "tts"))
    cache.mkdir(parents=True, exist_ok=True)
    kokoro = None
    for book in request["books"]:
        output = Path(book["dir"]) / "audio"
        output.mkdir(exist_ok=True)
        metadata = output / "manifest.json"
        try:
            previous = json.loads(metadata.read_text())
        except FileNotFoundError:
            previous = {}
        reusable = not request["force"] and previous.get("settings") == SETTINGS
        entries = {}
        for i, entry in enumerate(book["entries"], 1):
            path = output / entry["file"]
            old = previous.get("files", {}).get(entry["file"], {})
            expected = old.get("sha256")
            if not (reusable and old.get("phonemes") == entry.get("phonemes") and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected):
                if kokoro is None:
                    kokoro = Kokoro(asset(cache, "kokoro-v1.0.onnx"), asset(cache, "voices-v1.0.bin"))
                samples, rate = kokoro.create(entry.get("phonemes", entry["text"]), voice=SETTINGS["voice"], speed=SETTINGS["speed"], lang=SETTINGS["lang"], is_phonemes="phonemes" in entry)
                if rate != SETTINGS["sampleRate"] or not len(samples) or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.001:
                    raise ValueError(f"Invalid/silent audio for {entry['text']!r}")
                # Brief silence prevents clipped word onsets/ends on mobile.
                samples = np.pad(samples, (1200, 2400))
                temp = path.with_suffix(".tmp.wav")
                sf.write(temp, samples, rate, subtype="PCM_16")
                temp.replace(path)
                print(f"{Path(book['dir']).name} {i}/{len(book['entries'])}: {entry['text']}", flush=True)
            entries[entry["file"]] = {"text": entry["text"], "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            if "phonemes" in entry:
                entries[entry["file"]]["phonemes"] = entry["phonemes"]
        # Publish the manifest only once every requested clip is complete.
        temp = metadata.with_suffix(".tmp.json")
        temp.write_text(json.dumps({"settings": SETTINGS, "files": entries}, indent=2, ensure_ascii=False) + "\n")
        temp.replace(metadata)
        print(f"Ready: {output} ({len(entries)} clips)", flush=True)


if __name__ == "__main__":
    main()
