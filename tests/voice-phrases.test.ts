import {test,expect} from 'vitest';
import {VoicePhrases} from '../packages/voice/phrases.ts';
test('complete phrases stream before the response finishes',()=>{const p=new VoicePhrases();expect(p.push('Hello')).toEqual([]);expect(p.push('. Next')).toEqual(['Hello.']);expect(p.push(' sentence. ')).toEqual(['Next sentence.']);expect(p.finish()).toEqual([]);});
test('split decimal and punctuation tokens are retained until a boundary',()=>{const p=new VoicePhrases();expect(p.push('It costs 3.')).toEqual([]);expect(p.push('14 today.')).toEqual([]);expect(p.push(' More')).toEqual(['It costs 3.14 today.']);expect(p.finish()).toEqual(['More']);});
test('long text is bounded without splitting surrogate pairs',()=>{const p=new VoicePhrases(32);const text='a'.repeat(31)+'😀'+'b'.repeat(40);const out=[...p.push(text),...p.finish()];expect(out.join('')).toBe(text);expect(out.every(s=>s.length<=32)).toBe(true);});
test('STOP discards pending text and rejects late fragments',()=>{const p=new VoicePhrases();p.push('Unfinished private text');p.cancel();expect(()=>p.push('late')).toThrow();expect(()=>p.finish()).toThrow();});
test('turn limits close the stream and prevent later leakage',()=>{const p=new VoicePhrases(32,32);expect(()=>p.push('a'.repeat(33))).toThrow();expect(()=>p.finish()).toThrow();expect(()=>new VoicePhrases(1)).toThrow();});
