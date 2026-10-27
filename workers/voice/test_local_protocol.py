import io,json,unittest
from local_protocol import serve,MAX_AUDIO
class Engine:
    def synthesize(self,text):
        yield b'\x00\x00'*10
        yield b'\x01\x00'*10
class ProtocolTests(unittest.TestCase):
    def run_protocol(self,requests,factory=Engine):
        out=io.StringIO();serve(io.StringIO(requests),out,factory)
        return [json.loads(line) for line in out.getvalue().splitlines()]
    def test_resident_warmup_and_two_requests(self):
        rows=self.run_protocol(' {"id":0,"text":"Hello."}\n{"id":1,"text":"Again."}\n')
        self.assertEqual(rows[0]['type'],'ready')
        self.assertEqual([r['id'] for r in rows if r['type']=='done'],[0,1])
        self.assertEqual([r['seq'] for r in rows if r['type']=='pcm'],[0,1,0,1])
        self.assertNotIn('Hello',str(rows))
    def test_no_ready_before_successful_warmup(self):
        class Empty:
            def synthesize(self,text):return iter([])
        self.assertEqual(self.run_protocol('',Empty),[{'type':'error','code':'LOCAL_VOICE_UNAVAILABLE'}])
    def test_unpronounceable_request_reports_empty_result_and_worker_continues(self):
        class Picky:
            def synthesize(self,text):
                return iter([]) if text=='~' else iter([b'\x01\x00'])
        rows=self.run_protocol('{"id":0,"text":"~"}\n{"id":1,"text":"Hello."}\n',Picky)
        self.assertEqual(rows[0]['type'],'ready')
        self.assertIn({'type':'done','id':0,'chunks':0,'elapsed_ms':rows[1].get('elapsed_ms')},rows)
        self.assertEqual([r['id'] for r in rows if r['type']=='done'],[0,1])
        self.assertNotIn('error',[r['type'] for r in rows])
    def test_invalid_requests_fail_without_echoing_input(self):
        for request in [{'id':True,'text':'secret'},{'id':1,'text':'secret'},{'id':0,'text':'secret','path':'x'},{'id':0,'text':'x'*1001},{'id':0,'text':''}]:
            rows=self.run_protocol(json.dumps(request)+'\n');self.assertEqual(rows[-1]['type'],'error');self.assertNotIn('secret',str(rows))
        self.assertEqual(self.run_protocol('x'*8193)[-1]['type'],'error')
    def test_malformed_and_oversized_audio_fail(self):
        for block in [b'x',b'',b'x'*4802]:
            class Bad:
                def synthesize(self,text):yield block
            self.assertEqual(self.run_protocol('',Bad)[0]['type'],'error')
        class Endless:
            def synthesize(self,text):
                for _ in range(MAX_AUDIO//4800+1):yield b'x'*4800
        self.assertEqual(self.run_protocol('',Endless)[0]['type'],'error')
    def test_native_piper_rate_and_rate_specific_audio_bound(self):
        out=io.StringIO();serve(io.StringIO('{"id":0,"text":"Test."}\n'),out,Engine,rate=22050)
        rows=[json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(rows[0]['rate'],22050)
        self.assertTrue(all(row['rate']==22050 for row in rows if row['type']=='pcm'))
        class Oversized:
            def synthesize(self,text):yield b'x'*4412
        out=io.StringIO();serve(io.StringIO(''),out,Oversized,rate=22050)
        self.assertEqual(json.loads(out.getvalue())['type'],'error')
    def test_unknown_rate_fails_before_loading_model(self):
        def forbidden():raise AssertionError('must not load')
        out=io.StringIO();serve(io.StringIO(''),out,forbidden,rate=44100)
        self.assertEqual(json.loads(out.getvalue())['type'],'error')
    def test_staged_preparation_is_bounded_and_contains_no_audio(self):
        def load(progress):
            progress('acknowledgements')
            return Engine()
        out=io.StringIO();serve(io.StringIO(''),out,load,report_stages=True)
        rows=[json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual([r.get('stage') for r in rows[:-1]],['model','acknowledgements','warmup'])
        self.assertEqual(rows[-1]['type'],'ready')
        self.assertTrue(all(set(r)=={'type','stage','elapsed_ms'} for r in rows[:-1]))
        self.assertEqual(sorted(r['elapsed_ms'] for r in rows[:-1]),[r['elapsed_ms'] for r in rows[:-1]])
    def test_failed_stage_never_claims_ready_and_error_does_not_echo_paths(self):
        def load(progress):
            progress('acknowledgements')
            raise RuntimeError('private path')
        out=io.StringIO();serve(io.StringIO(''),out,load,report_stages=True)
        rows=[json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(rows[-1]['type'],'error')
        self.assertNotIn('ready',[r['type'] for r in rows]);self.assertNotIn('private',out.getvalue())
    def test_fresh_acknowledgement_cache_proves_readiness_without_sixth_inference(self):
        from acknowledgements import CachedSpeech,ACKNOWLEDGEMENTS
        calls=[]
        class Counting(Engine):
            def synthesize(self,text):
                calls.append(text)
                yield from super().synthesize(text)
        out=io.StringIO()
        serve(io.StringIO(''),out,lambda:CachedSpeech(Counting()),warmup_text='On it.')
        self.assertEqual(calls,list(ACKNOWLEDGEMENTS))
        self.assertEqual([row['type'] for row in map(json.loads,out.getvalue().splitlines())],['ready'])
        class Corrupt(CachedSpeech):
            def __init__(self):
                super().__init__(Counting())
                self.cache['On it.']=(b'odd',)
        out=io.StringIO();serve(io.StringIO(''),out,Corrupt,warmup_text='On it.')
        self.assertEqual(json.loads(out.getvalue())['type'],'error')
    def test_dependency_error_is_generic(self):
        def fail():raise RuntimeError('private local path')
        self.assertEqual(self.run_protocol('',fail),[{'type':'error','code':'LOCAL_VOICE_UNAVAILABLE'}])
if __name__=='__main__':unittest.main()
