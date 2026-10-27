"""Offline check of the speaker finder with a synthetic dataset (no real voices)."""
import importlib.util, io, json, sys, tarfile
from pathlib import Path
import av, numpy as np

spec = importlib.util.spec_from_file_location('find_speakers', Path(__file__).with_name('find-speakers.py'))
fs = importlib.util.module_from_spec(spec); spec.loader.exec_module(fs)

def mp3(seconds, noise, lowpass=False, seed=0):
    rng = np.random.default_rng(seed); rate = 22050; t = np.arange(int(rate * seconds)) / rate
    env = (np.sin(2 * np.pi * 3 * t) > -0.3).astype(np.float32)
    voice = 0.3 * env * (np.sin(2 * np.pi * 220 * t) + 0.4 * np.sin(2 * np.pi * (5200 if not lowpass else 900) * t))
    x = np.concatenate([np.zeros(rate // 2), voice, np.zeros(rate // 2)]) + noise * rng.standard_normal(len(voice) + rate)
    buf = io.BytesIO()
    with av.open(buf, 'w', format='mp3') as c:
        s = c.add_stream('mp3', rate=rate); s.layout = 'mono'
        frame = av.AudioFrame.from_ndarray(x.astype(np.float32).reshape(1, -1), format='flt', layout='mono'); frame.rate = rate
        for p in s.encode(frame): c.mux(p)
        for p in s.encode(None): c.mux(p)
    return buf.getvalue()

def build(tmp: Path, sep='\t'):
    speakers = {'clean': ('female_feminine', 0.002, False), 'noisy': ('female_feminine', 0.08, False),
                'phone': ('female_feminine', 0.002, True), 'man': ('male_masculine', 0.001, False), 'few': ('female_feminine', 0.001, False)}
    rows, files = [sep.join(['client_id', 'path', 'sentence', 'up_votes', 'down_votes', 'age', 'gender', 'accents'])], {}
    for sid, (gender, noise, low) in speakers.items():
        for i in range(5 if sid == 'few' else 18):
            name = f'cv_{sid}_{i}.mp3'; files[name] = mp3(2.5, noise, low, seed=i)
            rows.append(sep.join([sid, name, f'Sentence {i}.', '2', '0', 'thirties', gender, 'Australian English']))
    archive = tmp / 'en-au.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        meta = '\n'.join(rows).encode()
        info = tarfile.TarInfo('cv-au/validated.tsv'); info.size = len(meta); tar.addfile(info, io.BytesIO(meta))
        for n, d in files.items():
            info = tarfile.TarInfo(f'cv-au/clips/{n}'); info.size = len(d); tar.addfile(info, io.BytesIO(d))
    return archive

def test_ranks_clean_women_first_and_excludes_men_and_small_sets(tmp_path):
    archive = build(tmp_path)
    assert fs.main([str(archive), '--out', str(tmp_path / 'out')]) == 0
    report = json.loads((tmp_path / 'out' / 'candidates.json').read_text())
    keys = [r['speaker_key'] for r in report]
    assert keys[0] == 'clean' and 'man' not in keys and 'few' not in keys
    assert keys.index('noisy') > 0 and keys.index('phone') > 0
    wav = tmp_path / 'out' / 'candidates' / 'candidate-1.wav'
    assert wav.exists() and wav.stat().st_size > 22050 * 2 * 10

def test_csv_and_extracted_folder_also_work(tmp_path):
    archive = build(tmp_path, sep=',')
    folder = tmp_path / 'x'; tarfile.open(archive).extractall(folder, filter='data')
    assert fs.main([str(folder), '--out', str(tmp_path / 'o2')]) == 0

def test_missing_gender_column_is_reported_not_crashed(tmp_path):
    (tmp_path / 'd').mkdir(); (tmp_path / 'd' / 'a.tsv').write_text('client_id\tpath\nx\ty.mp3\n')
    assert fs.main([str(tmp_path / 'd'), '--out', str(tmp_path / 'o3')]) == 1

def load(name):
    sp = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(f'{name}.py'))
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m

def test_script_builder_keeps_harmony_lines_and_filters_unreadable_sentences(tmp_path):
    ms = load('make-script')
    assert ms.clean('The cat sat on the old wooden mat') == 'The cat sat on the old wooden mat.'
    for bad in ['It costs 5 dollars today friend.', 'Too short.', 'See the NASA and FBI files now please.', 'Email me at x@y.com please now.']:
        assert ms.clean(bad) is None
    rows = ['client_id\tpath\tsentence\tgender'] + [f'c{i}\tf{i}.mp3\t{s}\tfemale_feminine' for i, s in enumerate(
        f'The {a} {b} walked quietly through the {c} garden.' for a in ['quick', 'lazy', 'bright', 'gentle', 'tired', 'happy', 'clever', 'shy', 'proud', 'calm']
        for b in ['fox', 'dog', 'bird', 'cat', 'horse'] for c in ['green', 'empty', 'misty', 'royal', 'hidden'])]
    (tmp_path / 'd').mkdir(); (tmp_path / 'd' / 'validated.tsv').write_text('\n'.join(rows))
    assert ms.main([str(tmp_path / 'd'), '--count', '120', '--out', str(tmp_path / 'o')]) == 0
    lines = (tmp_path / 'o' / 'script.txt').read_text().splitlines()
    own = [l for l in (Path(__file__).with_name('harmony-lines.txt')).read_text().splitlines() if l.strip()]
    assert lines[:len(own)] == own and len(lines) == 120 and len(set(lines)) == 120

def test_dataset_check_keeps_matching_lines_and_lists_rejects(tmp_path):
    cd = load('check-dataset'); g = load('generate')
    assert cd.wer(cd.words("G'day, I'm Harmony!"), cd.words('gday im harmony')) == 0
    assert cd.wer(['a', 'b', 'c', 'd'], ['a', 'x', 'c']) == 0.5
    data = tmp_path / 'dataset'; (data / 'wavs').mkdir(parents=True)
    for k in ['au00001', 'au00002']: g.write_wav(data / 'wavs' / f'{k}.wav', np.sin(np.arange(22050) / 9).astype(np.float32))
    (data / 'metadata.csv').write_text('au00001|Hello there friend.\nau00002|Timer set for ten minutes.\n')
    heard = iter(['hello there friend', 'time is up'])
    assert cd.main(['--data', str(data)], recognize=lambda _a: next(heard)) == 0
    assert (data / 'metadata.clean.csv').read_text() == 'au00001|Hello there friend.\n'
    assert 'au00002|Timer set for ten minutes.|time is up|' in (data / 'rejected.csv').read_text()

def test_generator_helpers_reject_failed_takes_and_cut_reference_at_a_pause(tmp_path, monkeypatch):
    g = load('generate')
    rate = g.RATE
    assert g.plausible(np.zeros(rate * 3), 'one two three four five six')
    assert not g.plausible(np.zeros(rate * 18), 'hi there')        # babble
    assert not g.plausible(np.zeros(int(rate * 0.4)), 'a whole long sentence of words here')  # cut short
    monkeypatch.setattr(g, 'OUT', tmp_path)
    (tmp_path / 'candidates').mkdir()
    tone = lambda s: 0.5 * np.sin(np.arange(int(rate * s)) / 5).astype(np.float32)
    clip = np.concatenate([tone(4), np.zeros(int(rate * 0.5)), tone(4.5), np.zeros(int(rate * 0.5)), tone(4)])
    g.write_wav(tmp_path / 'candidates' / 'candidate-2.wav', clip)
    x, r = g.read_wav(g.make_reference(2))
    assert r == rate and 8.0 < len(x) / rate <= 11.0                 # ends in the pause after the second phrase

def test_multispeaker_set_keeps_the_chosen_voice_caps_others_and_resumes(tmp_path):
    ms = load('build-multispeaker')
    archive = build(tmp_path)
    out = tmp_path / 'out'
    assert fs.main([str(archive), '--out', str(out)]) == 0
    report = json.loads((out / 'candidates.json').read_text())
    voice = next(r['candidate'] for r in report if r['speaker_key'] == 'phone')  # pick a lower-ranked one on purpose
    assert ms.main(['build', str(archive), '--out', str(out)]) == 1                       # must score first
    assert ms.main(['score', str(archive), '--out', str(out)]) == 0
    scored = (out / 'scores.jsonl').read_text().splitlines()
    assert ms.main(['score', str(archive), '--out', str(out)]) == 0                       # resumes: nothing new
    assert (out / 'scores.jsonl').read_text().splitlines() == scored
    assert ms.main(['build', str(archive), '--out', str(out), '--voice', str(voice), '--min-score', '20', '--min-clips', '10', '--per-speaker', '12']) == 0
    meta = (out / 'train' / 'metadata.csv').read_text().splitlines()
    labels = [m.split('|')[1] for m in meta]
    assert labels[0] == 'harmony' and labels.count('harmony') >= 10
    assert all(labels.count(l) <= 12 for l in set(labels) - {'harmony'}) or labels.count('harmony') <= 18
    assert 'man' not in (out / 'train' / 'speakers.json').read_text()
    first = meta[0].split('|')[0]
    with av.open(str(out / 'train' / 'wavs' / first)) as c:
        st = c.streams.audio[0]; assert st.rate == 22050 and st.codec_context.name == 'flac'
