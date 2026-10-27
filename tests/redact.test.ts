import {expect,test} from 'vitest';
import {hasSecret,luhn,redact,redactUrl} from '../core/redact.ts';

// Fake keys are assembled at run time so the source never contains a string shaped like a real one.
const fake=(prefix:string,n:number)=>prefix+'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2).slice(0,n);
test('secrets are masked by their shape',()=>{
 expect(redact('my card is 4111 1111 1111 1111 exp 04/29')).toBe('my card is [card number removed] exp 04/29');
 expect(redact('password: hunter22 for the router')).toBe('password: [removed] for the router');
 expect(redact('the wifi password is Sunset!2026')).toBe('the wifi password is [removed]');
 expect(redact('your verification code is 482913')).toBe('your verification code is [code removed]');
 expect(redact('SSN 123-45-6789')).toBe('SSN [SSN removed]');
 expect(redact(`key ${fake('sk-proj-',27)}`)).toBe('key [key removed]');
 expect(redact(fake('AIza',35))).toBe('[key removed]');
 expect(redact(fake('ghp_',36))).toBe('[key removed]');
 expect(redact('Authorization: Bearer abc.def-ghi_jkl012345678')).toBe('Authorization: Bearer [token removed]');
 expect(redact('https://alec:s3cret@example.com/x')).toBe('https://example.com/x');
 expect(redact('routing number 075000022')).toBe('routing number [number removed]');
 expect(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toBe('[token removed]');
});
test('ordinary text is left alone',()=>{
 for(const t of ['Remind me to call Jordan at 4','Unit 214 needs a faucet cartridge, order 1234567890123','What is the population of Madison?',
  'Call 608-555-0142','Research the best remote design jobs paying over 80000','The 2026 World Series','password manager reviews'])
  expect(redact(t)).toBe(t);
 expect(hasSecret('pin 4821')).toBe(true);expect(luhn('4111111111111111')).toBe(true);expect(luhn('1234567890123')).toBe(false);
});
test('web addresses keep their path; only a written-in login is removed',()=>{
 expect(redactUrl('https://bob:pw@github.com/a/b/commit/0123456789abcdef0123456789abcdef01234567')).toBe('https://github.com/a/b/commit/0123456789abcdef0123456789abcdef01234567');
});
