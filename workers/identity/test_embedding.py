from pathlib import Path
import runpy
import numpy as np
import pytest
module=runpy.run_path(str(Path(__file__).with_name('embedding.py')))
Extractor=module['SpeakerExtractor']

def test_bad_audio_is_rejected_before_inference():
    extractor=object.__new__(Extractor)
    for audio in [np.zeros(32000,dtype=np.float32),np.ones(31999,dtype=np.float32),np.ones(160001,dtype=np.float32),np.ones(32000,dtype=np.float64),np.ones((32000,1),dtype=np.float32),np.full(32000,np.nan,dtype=np.float32),np.full(32000,2,dtype=np.float32)]:
        with pytest.raises(ValueError):extractor.compute(audio)

def test_modified_model_is_rejected_before_loading(tmp_path):
    location=tmp_path/'data/models/speaker'/module['MODEL_NAME'];location.parent.mkdir(parents=True)
    location.write_bytes(b'not a model')
    with pytest.raises(ValueError,match='unavailable'):Extractor(tmp_path)
