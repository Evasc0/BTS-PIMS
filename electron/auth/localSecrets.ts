import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { app } from 'electron';

const ENCRYPTION_VERSION = 'v1';
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

const deriveKey = (): Buffer => {
  const seed =
    process.env.LOCAL_AUTH_ENCRYPTION_KEY ||
    `bts-inventory-local-auth:${app.getPath('userData')}:${app.getName()}`;
  return createHash('sha256').update(seed).digest();
};

const encode = (value: Buffer): string => value.toString('base64');
const decode = (value: string): Buffer => Buffer.from(value, 'base64');

export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const encryptLocalSecret = (plainText: string): string => {
  const iv = randomBytes(GCM_IV_BYTES);
  const key = deriveKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_VERSION}:${encode(iv)}:${encode(tag)}:${encode(encrypted)}`;
};

export const decryptLocalSecret = (cipherText: string | null | undefined): string | null => {
  if (!cipherText) return null;

  const parts = cipherText.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) return null;

  try {
    const iv = decode(parts[1]);
    const tag = decode(parts[2]);
    const data = decode(parts[3]);
    const key = deriveKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
};

