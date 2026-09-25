import crypto from 'node:crypto';

function scryptHash(password: string, salt?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const realSalt = salt || crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, realSalt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve('scrypt:' + realSalt + ':' + derived.toString('hex'));
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  // Use scrypt only for portability (no native modules required)
  return scryptHash(password);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  if (!stored) return false;
  const [scheme, rest] = stored.split(':', 2);
  if (scheme === 'scrypt') {
    // Format: scrypt:salt:hash
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const [_s, salt, hex] = parts;
    return new Promise<boolean>((resolve) => {
      crypto.scrypt(plain, salt, 64, (err, derived) => {
        if (err) return resolve(false);
        resolve(derived.toString('hex') === hex);
      });
    });
  }
  // Legacy argon2 hashes: auto-migrate on next login
  // If the stored hash looks like an argon2 hash ($argon2...), we can't verify
  // without the native module. Return false so the UI shows invalid credentials.
  // The admin DB fix script or reset must be used to update the hash.
  if (stored.startsWith('$argon2')) {
    return false; // argon2 not available without native module
  }
  return false;
}