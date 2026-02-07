const encodeBase64 = (data: Uint8Array): string => {
  let binary = '';
  data.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const decodeBase64 = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const hashWithSalt = async (password: string, salt: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${password}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return encodeBase64(new Uint8Array(hashBuffer));
};

export const createPasswordHash = async (password: string): Promise<{ hash: string; salt: string }> => {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = encodeBase64(saltBytes);
  const hash = await hashWithSalt(password, salt);
  return { hash, salt };
};

export const verifyPassword = async (
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> => {
  if (!storedHash || !storedSalt) return false;
  const hash = await hashWithSalt(password, storedSalt);
  return hash === storedHash;
};

export const regenerateApiKey = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64(bytes).replace(/=+$/u, '');
};

export const maskSecret = (value: string): string => {
  if (!value) return '';
  const visible = value.slice(-4);
  return `${'*'.repeat(Math.max(0, value.length - 4))}${visible}`;
};
