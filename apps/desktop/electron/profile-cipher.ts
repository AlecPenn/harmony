import {safeStorage} from 'electron';
import type {ProfileCipher} from '../../../packages/identity/vault.ts';
/** Windows-only until other OS key providers are explicitly reviewed. */
export const windowsProfileCipher:ProfileCipher={
  available:async()=>process.platform==='win32'&&await safeStorage.isAsyncEncryptionAvailable(),
  encrypt:plaintext=>safeStorage.encryptStringAsync(plaintext),
  decrypt:async ciphertext=>(await safeStorage.decryptStringAsync(ciphertext)).result
};
