#!/usr/bin/env python3
"""A/V sync + frame-cadence check for a test-pattern clip.
Test pattern contract: a full-white frame at every whole second, and a 1 kHz beep
starting at every whole second. Reports flash times, beep onsets and their offsets."""
import json, re, subprocess, sys
p = sys.argv[1]
v = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-an', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], capture_output=True, text=True).stderr
frames = []
pts = None
for line in v.splitlines():
    m = re.search(r'pts_time:([\d.]+)', line)
    if m: pts = float(m.group(1))
    m = re.search(r'YAVG=([\d.]+)', line)
    if m and pts is not None: frames.append((pts, float(m.group(1))))
flashes = [t for (t, y) in frames if y > 200]
a = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-vn', '-af', 'silencedetect=n=-35dB:d=0.1', '-f', 'null', '-'], capture_output=True, text=True).stderr
beeps = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', a)]
if not beeps or (flashes and beeps[0] > flashes[0] + 0.5):
    beeps = [0.0] + beeps  # clip starts with a beep, so there is no leading silence_end
gaps = [round(frames[i + 1][0] - frames[i][0], 4) for i in range(len(frames) - 1)]
pairs = []
for f in flashes:
    near = min(beeps, key=lambda b: abs(b - f)) if beeps else None
    pairs.append({'flash': round(f, 4), 'beep': None if near is None else round(near, 4), 'audioMinusVideoMs': None if near is None else round((near - f) * 1000, 1)})
edit = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration', '-of', 'json', p], capture_output=True, text=True).stdout
out = {'file': p, 'videoFrames': len(frames), 'maxFrameGapMs': round(max(gaps) * 1000, 1) if gaps else None, 'flashes': flashes, 'beepOnsets': beeps, 'pairs': pairs,
       'worstOffsetMs': max((abs(x['audioMinusVideoMs']) for x in pairs if x['audioMinusVideoMs'] is not None), default=None), 'streams': json.loads(edit).get('streams')}
print(json.dumps(out, indent=1))
