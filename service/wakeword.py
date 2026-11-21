#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Детектор слова активации: потоковый инференс модели `wake.bin`.

Формат и архитектура — из проекта YaJavis (MIT, newfpv/YaJavis): `jarvisd/kws.go`
и `kws/train.py`. Модель обучена на слове «Джарвис», весит 175 КБ и не требует
ни TensorFlow, ни ONNX — только numpy.

    python3 wakeword.py <файл.wav>      # максимальная вероятность по файлу
    python3 wakeword.py --info          # заголовок модели

Пайплайн на каждые 10 мс звука (16 кГц):
  1. окно 25 мс, FFT 512, 40 треугольных мел-фильтров 20–7600 Гц (HTK);
  2. log(power + 1e-6), нормировка mean/std из модели;
  3. линейная проекция 40→48, ReLU;
  4. шесть свёрток k=3 с dilation 1,2,4,8,16,32 и остаточной связью;
  5. голова 48→1, sigmoid, сглаживание за 3 кадра;
  6. порог из таблицы чувствительности 1..10.

Состояние (кольцевые буферы слоёв) хранится в объекте, поэтому поток
обрабатывается кадр за кадром без пересчёта истории.
"""

from __future__ import annotations

import json
import math
import struct
import sys

import numpy as np

MAGIC = b"JKWS1"


class WakeModel:
    """Загруженная модель и её состояние."""

    def __init__(self, data: bytes):
        if data[:5] != MAGIC:
            raise ValueError("wake.bin: не тот формат")
        header_len = struct.unpack("<I", data[5:9])[0]
        header = json.loads(data[9:9 + header_len].decode("utf-8"))
        raw = data[9 + header_len:]
        if len(raw) % 4:
            raise ValueError("wake.bin: веса повреждены")

        self.header = header
        self.sample_rate = int(header["sample_rate"])
        self.win = int(header["win"])
        self.hop = int(header["hop"])
        self.n_fft = int(header["n_fft"])
        self.n_mels = int(header["n_mels"])
        self.channels = int(header["channels"])
        self.kernel = int(header["kernel"])
        self.dilations = list(header["dilations"])
        self.thresholds = list(header["thresholds"])
        if len(self.thresholds) != 10:
            raise ValueError("wake.bin: нужно 10 порогов")

        weights = np.frombuffer(raw, dtype="<f4")

        def take(count: int) -> np.ndarray:
            nonlocal weights
            if weights.size < count:
                raise ValueError("wake.bin: весов меньше, чем нужно")
            part, weights = weights[:count], weights[count:]
            return part.astype(np.float32)

        self.mean = take(self.n_mels)
        self.std = take(self.n_mels)
        self.proj_w = take(self.channels * self.n_mels).reshape(self.channels, self.n_mels)
        self.proj_b = take(self.channels)
        self.blocks = []
        for _ in self.dilations:
            w = take(self.channels * self.channels * self.kernel)
            b = take(self.channels)
            self.blocks.append((w.reshape(self.channels, self.channels, self.kernel), b))
        self.head_w = take(self.channels)
        self.head_b = take(1)
        if weights.size:
            raise ValueError("wake.bin: лишние веса (%d)" % weights.size)

        self.window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(self.win) / self.win)
        self.mel = self._mel_bank()
        self.reset()

    def _mel_bank(self) -> np.ndarray:
        bins = self.n_fft // 2 + 1
        fmin = float(self.header.get("fmin", 20))
        fmax = float(self.header.get("fmax", 7600))

        def hz_to_mel(f):
            return 2595.0 * math.log10(1.0 + f / 700.0)

        def mel_to_hz(m):
            return 700.0 * (10.0 ** (m / 2595.0) - 1.0)

        lo, hi = hz_to_mel(fmin), hz_to_mel(fmax)
        pts = [mel_to_hz(lo + (hi - lo) * i / (self.n_mels + 1))
               for i in range(self.n_mels + 2)]
        freqs = np.arange(bins) * self.sample_rate / self.n_fft
        bank = np.zeros((self.n_mels, bins), dtype=np.float32)
        for m in range(self.n_mels):
            left, center, right = pts[m], pts[m + 1], pts[m + 2]
            up = (freqs > left) & (freqs < center)
            down = (freqs >= center) & (freqs < right)
            bank[m, up] = (freqs[up] - left) / (center - left)
            bank[m, down] = (right - freqs[down]) / (right - center)
        return bank

    def reset(self) -> None:
        self.hist = [np.zeros((self.channels, (self.kernel - 1) * d + 1), dtype=np.float32)
                     for d in self.dilations]
        self.pos = [0] * len(self.dilations)
        self.tail = np.zeros(0, dtype=np.float64)
        self.smooth = [0.0, 0.0, 0.0]
        self.smooth_i = 0
        self.cooldown = 0
        self.frames = 0
        self.last_prob = 0.0

    # ------------------------------------------------------------------ DSP --
    def _frame(self, samples: np.ndarray) -> float:
        spec = np.fft.rfft(samples * self.window, n=self.n_fft)
        power = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
        mel = self.mel @ power
        feat = (np.log(mel + 1e-6) - self.mean) / self.std

        act = np.maximum(self.proj_w @ feat + self.proj_b, 0.0)
        for i, (w, b) in enumerate(self.blocks):
            dil = self.dilations[i]
            span = (self.kernel - 1) * dil + 1
            ring = self.hist[i]
            ring[:, self.pos[i]] = act
            # окно по времени: t=k-1 — текущий кадр, t=0 — самый старый
            idx = [(self.pos[i] - (self.kernel - 1 - t) * dil) % span
                   for t in range(self.kernel)]
            window = ring[:, idx]                      # (channels, k)
            out = np.tensordot(w, window, axes=([1, 2], [0, 1])) + b
            self.pos[i] = (self.pos[i] + 1) % span
            act = act + np.maximum(out, 0.0)           # остаточная связь

        logit = float(self.head_w @ act + self.head_b[0])
        prob = 1.0 / (1.0 + math.exp(-logit))
        self.smooth[self.smooth_i % 3] = prob
        self.smooth_i += 1
        self.last_prob = sum(self.smooth) / 3
        self.frames += 1
        return self.last_prob

    def feed(self, pcm: np.ndarray, sensitivity: int = 5) -> bool:
        """Скормить s16-звук; True — слово только что распознано."""
        self.tail = np.concatenate([self.tail, pcm.astype(np.float64) / 32768.0])
        hit = False
        off = 0
        while len(self.tail) - off >= self.win:
            prob = self._frame(self.tail[off:off + self.win])
            if self.cooldown > 0:
                self.cooldown -= 1
            elif prob >= self.thresholds[max(1, min(10, sensitivity)) - 1]:
                self.cooldown = 150          # 1.5 с: хвост собственного слова
                hit = True
            off += self.hop
        self.tail = self.tail[off:]
        return hit

    def info(self) -> dict:
        return {
            "sample_rate": self.sample_rate,
            "win": self.win,
            "hop": self.hop,
            "n_fft": self.n_fft,
            "n_mels": self.n_mels,
            "channels": self.channels,
            "dilations": self.dilations,
            "thresholds": [round(t, 4) for t in self.thresholds],
            "weights": sum(w.size for w, _ in self.blocks) + self.proj_w.size + self.head_w.size,
        }


def load(path: str) -> WakeModel:
    with open(path, "rb") as fh:
        return WakeModel(fh.read())


def score_wav(path: str, model_path: str = "/data/mypult/wake.bin",
              sensitivity: int = 5) -> dict:
    """Прогнать файл целиком и вернуть пик вероятности и число срабатываний."""
    import wave

    model = load(model_path)
    with wave.open(path, "rb") as wav:
        raw = wav.readframes(wav.getnframes())
    pcm = np.frombuffer(raw, dtype="<i2")
    hits = 0
    peak = 0.0
    chunk = 1600                                   # по 100 мс, как приходит из micd
    for start in range(0, len(pcm), chunk):
        if model.feed(pcm[start:start + chunk], sensitivity):
            hits += 1
        peak = max(peak, model.last_prob)
    return {"peak": round(peak, 4), "hits": hits, "frames": model.frames}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("использование: wakeword.py <файл.wav> | --info <wake.bin>", file=sys.stderr)
        return 2
    if argv[1] == "--info":
        path = argv[2] if len(argv) > 2 else "/data/mypult/wake.bin"
        print(json.dumps(load(path).info(), ensure_ascii=False, indent=2))
        return 0
    model_path = argv[2] if len(argv) > 2 else "/data/mypult/wake.bin"
    print(json.dumps(score_wav(argv[1], model_path), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
