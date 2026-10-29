"""Assemble la vidéo : images filmées (images/), voix off placée aux bons moments (voix.json),
volume égalisé (-16 LUFS), encodage H.264 1080 × 1920 pour téléphone et WhatsApp.
   python monter.py   →   murya-espace-equipe.mp4
"""

import json
import os
import subprocess

DIR = os.path.dirname(os.path.abspath(__file__))
voix = json.load(open(os.path.join(DIR, "voix.json"), encoding="utf-8"))

inputs, filters = [], []
for k, v in enumerate(voix["voix"], start=1):
    inputs += ["-i", os.path.join(DIR, "audio", f"{v['id']}.wav")]
    ms = round(v["at"] * 1000)
    filters.append(f"[{k}:a]aresample=48000,adelay={ms}|{ms}[v{k}]")
n = len(voix["voix"])
filters.append(
    "".join(f"[v{k}]" for k in range(1, n + 1))
    + f"amix=inputs={n}:normalize=0,apad,atrim=0:{voix['total']:.2f},"
    + "loudnorm=I=-16:TP=-1.5:LRA=11[voix]"
)

cmd = [
    "ffmpeg", "-y", "-loglevel", "error", "-stats",
    "-framerate", "30", "-i", os.path.join(DIR, "images", "%05d.jpg"),
    *inputs,
    "-filter_complex", ";".join(filters),
    "-map", "0:v", "-map", "[voix]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ac", "1",
    "-movflags", "+faststart",
    os.path.join(DIR, "murya-espace-equipe.mp4"),
]
subprocess.run(cmd, check=True)
print("ok :", os.path.join(DIR, "murya-espace-equipe.mp4"))
