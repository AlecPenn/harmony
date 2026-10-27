import asyncio,runpy
from pathlib import Path
import pytest
module=runpy.run_path(str(Path(__file__).with_name('preview.py')))
connection={'region':'eastus','key':'fixture_not_a_real_key','voice':'en-AU-NatashaNeural'}

def test_connection_rejects_endpoint_injection_and_unknown_voices():
    for value in [{**connection,'region':'evil.com/path'},{**connection,'key':'short'},{**connection,'voice':'en-US-Other'},{**connection,'endpoint':'https://evil.example'}]:
        with pytest.raises(ValueError):module['validate_connection'](value)

def test_ssml_escapes_text_and_rejects_custom_markup_options():
    value=module['ssml']('a < b & c',connection['voice'],'natural')
    assert 'a &lt; b &amp; c' in value
    with pytest.raises(ValueError):module['ssml']('test',connection['voice'],'<break/>')

class Response:
    def __init__(self,status=200,blocks=None):self.status=status;self.blocks=blocks or [b'\x00',b'\x01\x02',b'\x03'];self.content=self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def iter_chunked(self,size):
        for block in self.blocks:yield block
class Client:
    def __init__(self,response):self.response=response;self.calls=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def post(self,url,**kwargs):self.calls.append((url,kwargs));return self.response

def test_streaming_handles_split_pcm_and_uses_only_fixed_microsoft_endpoint():
    client=Client(Response());events=[]
    function=module['main'];original=function.__globals__['emit'];function.__globals__['emit']=events.append
    try:asyncio.run(function('natural',connection,lambda **kwargs:client))
    finally:function.__globals__['emit']=original
    assert events[-1]['type']=='done' and events[-1]['chunks']==6
    assert all(len(__import__('base64').b64decode(e['pcm']))%2==0 for e in events[:-1])
    assert all(url=='https://eastus.tts.speech.microsoft.com/cognitiveservices/v1' and not kwargs['allow_redirects'] for url,kwargs in client.calls)
    assert all(kwargs['headers']['Ocp-Apim-Subscription-Key']==connection['key'] for _,kwargs in client.calls)

@pytest.mark.parametrize('response',[Response(403),Response(302),Response(200,[b'\x00'])])
def test_provider_denial_redirect_and_truncated_audio_fail_without_fallback(response):
    with pytest.raises(ValueError):asyncio.run(module['main']('natural',connection,lambda **kwargs:Client(response)))
