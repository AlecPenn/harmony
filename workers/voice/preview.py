"""Supported Azure Speech fixed-script audition. Credentials arrive via private stdin.
Only a region-derived Microsoft endpoint is allowed. No redirects or raw logging.
"""
import asyncio,base64,json,re,sys
from xml.sax.saxutils import escape
import aiohttp
PRESETS={'natural':'+0%','relaxed':'-6%','brisk':'+6%'}
VOICES={'en-AU-NatashaNeural','en-AU-FreyaNeural','en-AU-AnnetteNeural'}
SCRIPT=["Hi, I'm Harmony. A little order, a little attitude.",
        "I can help you keep track of your projects, and pick up where we left off.",
        "One thing at a time. We've got this."]

def validate_connection(value):
    if not isinstance(value,dict) or set(value)!={'region','key','voice'}:raise ValueError('Invalid connection')
    if not isinstance(value['region'],str) or not re.fullmatch(r'[a-z][a-z0-9]{1,39}',value['region']):raise ValueError('Invalid region')
    if not isinstance(value['key'],str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,128}',value['key']):raise ValueError('Invalid key')
    if value['voice'] not in VOICES:raise ValueError('Invalid voice')
    return value

def ssml(text,voice,preset):
    if voice not in VOICES or preset not in PRESETS:raise ValueError('Invalid voice options')
    return f'<speak version="1.0" xml:lang="en-AU"><voice name="{voice}"><prosody rate="{PRESETS[preset]}" pitch="+0Hz">{escape(text)}</prosody></voice></speak>'

def emit(value):print(json.dumps(value),flush=True)

async def main(preset,connection,client_factory=aiohttp.ClientSession):
    validate_connection(connection)
    if preset not in PRESETS:raise ValueError('Unknown preset')
    endpoint=f"https://{connection['region']}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers={'Ocp-Apim-Subscription-Key':connection['key'],'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'raw-24khz-16bit-mono-pcm','User-Agent':'HARMONY-voice-preview'}
    sequence=0;total=0
    async with client_factory(timeout=aiohttp.ClientTimeout(total=60,connect=10,sock_read=15),trust_env=False) as client:
        for text in SCRIPT:
            async with client.post(endpoint,headers=headers,data=ssml(text,connection['voice'],preset).encode('utf-8'),allow_redirects=False) as response:
                if response.status!=200:raise ValueError('Speech provider rejected the request')
                pending=b''
                async for block in response.content.iter_chunked(4800):
                    pending+=block;length=len(pending)//2*2
                    if not length:continue
                    pcm=pending[:length];pending=pending[length:];total+=len(pcm)
                    if total>24000*2*60:raise ValueError('Voice duration exceeds limit')
                    for offset in range(0,len(pcm),4800):
                        emit({'type':'pcm','seq':sequence,'rate':24000,'pcm':base64.b64encode(pcm[offset:offset+4800]).decode('ascii')});sequence+=1
                if pending:raise ValueError('Truncated PCM')
    if sequence==0:raise ValueError('Empty speech response')
    emit({'type':'done','chunks':sequence})

if __name__=='__main__':
    try:
        line=sys.stdin.buffer.readline(4097)
        if len(line)>4096:raise ValueError('Invalid connection')
        asyncio.run(asyncio.wait_for(main(sys.argv[1],json.loads(line)),timeout=60))
    except Exception:emit({'type':'error'})
