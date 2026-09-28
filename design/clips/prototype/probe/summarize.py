import json,glob,sys,os
files = sys.argv[1:] or sorted(glob.glob('results/*.json'))
for f in files:
    if f.endswith('.ffprobe.json'): continue
    d=json.load(open(f)); print('=====',d['label'])
    m=d.get('meta',{}); print(' ua:',m.get('ua'),'| secure',m.get('isSecureContext'),'| gpu',m.get('gpu'),'| hc',m.get('hardwareConcurrency'))
    a=d.get('apis',{}); print(' apis missing:',[k for k,v in a.items() if v in ('undefined',)] if isinstance(a,dict) else a)
    vc=d.get('videoConfigs',{}); print(' video true:',[k for k,v in vc.items() if v is True]); print(' video false:',[k for k,v in vc.items() if v is not True])
    print(' audio:',d.get('audioConfigs'))
    print(' MR:',{k:v for k,v in (d.get('mediaRecorderTypes') or {}).items() if v is True} if isinstance(d.get('mediaRecorderTypes'),dict) else d.get('mediaRecorderTypes'))
    print(' share:',d.get('share')); print(' storage:',d.get('storage'))
    for k in ('encodeMain720','encodeMainPortrait','worker','aacEncode','audioWorklet','muxMp4','mediaRecorderClip'): print(' ',k,':',json.dumps(d.get(k))[:900])
    print(' timings',d.get('timings'))
