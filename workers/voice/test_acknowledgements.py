import unittest
from acknowledgements import CachedSpeech,ACKNOWLEDGEMENTS,MAX_BYTES
class Engine:
    def __init__(self):self.calls=[]
    def synthesize(self,text):self.calls.append(text);yield b'\0\0'*20
class CacheTests(unittest.TestCase):
    def test_generic_audio_is_prepared_once_and_private_text_is_not_cached(self):
        engine=Engine();cached=CachedSpeech(engine)
        self.assertEqual(engine.calls,list(ACKNOWLEDGEMENTS))
        for _ in range(3):self.assertEqual(list(cached.synthesize('On it.')),[b'\0\0'*20])
        self.assertEqual(engine.calls,list(ACKNOWLEDGEMENTS))
        list(cached.synthesize('Private phrase'));list(cached.synthesize('Private phrase'))
        self.assertEqual(engine.calls[-2:],['Private phrase','Private phrase']);self.assertNotIn('Private phrase',cached.cache)
    def test_cache_cannot_grow_unbounded(self):
        class Large:
            def synthesize(self,text):
                for _ in range(MAX_BYTES//4800+1):yield b'\0'*4800
        with self.assertRaises(ValueError):CachedSpeech(Large())
    def test_invalid_audio_and_empty_voice_fail(self):
        for value in [b'',b'odd']:
            class Invalid:
                def synthesize(self,text):yield value
            with self.assertRaises(ValueError):CachedSpeech(Invalid())
        class Empty:
            def synthesize(self,text):return iter([])
        with self.assertRaises(ValueError):CachedSpeech(Empty())
if __name__=='__main__':unittest.main()
