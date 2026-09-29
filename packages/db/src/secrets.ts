import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for stored credentials. Format: v1:<iv>:<tag>:<ciphertext> (base64).
 * The key comes from MASTER_KEY (64 hex characters) and never touches the database.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterKeyHex: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
      throw new Error('MASTER_KEY must be 64 hexadecimal characters (32 bytes)');
    }
    this.key = Buffer.from(masterKeyHex, 'hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(envelope: string): string {
    const [version, ivB64, tagB64, dataB64] = envelope.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || dataB64 === undefined) {
      throw new Error('Unrecognised secret format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
