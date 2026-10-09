import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// A fake S3 SDK: records what the storage service asks for, talks to nothing.
const sent = [];
vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(input) {
      this.input = input;
    }
  }
  return {
    S3Client: class {
      constructor(options) {
        this.options = options;
      }
      async send(command) {
        sent.push(command);
        return {};
      }
    },
    PutObjectCommand: class PutObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client, command, { expiresIn }) =>
    `https://medflow-docs.s3.amazonaws.com/${command.input.Key}?X-Amz-Expires=${expiresIn}&X-Amz-Signature=abc`
  ),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../src/config/index.js';
import {
  getDownloadUrl,
  uploadFile,
  contentDisposition,
  originalFileName,
} from '../../src/services/storageService.js';

const original = { ...config.storage, s3: { ...config.storage.s3 } };

beforeAll(() => {
  config.storage.driver = 's3';
  config.storage.s3.bucket = 'medflow-docs';
  config.storage.s3.accessKeyId = 'test';
  config.storage.s3.secretAccessKey = 'test';
});

afterAll(() => {
  Object.assign(config.storage, original);
});

describe('S3 storage driver (mocked client)', () => {
  it('creates a pre-signed GET URL that expires in 15 minutes', async () => {
    const link = await getDownloadUrl('1712345678901_lab report.pdf', { contentType: 'application/pdf' });

    expect(link).toMatchObject({ success: true, expiresIn: 900 });
    expect(link.url).toContain('X-Amz-Expires=900');

    const [, command, options] = getSignedUrl.mock.calls[0];
    expect(options).toEqual({ expiresIn: 900 });
    expect(command.constructor.name).toBe('GetObjectCommand');
    expect(command.input).toEqual({
      Bucket: 'medflow-docs',
      Key: 'documents/1712345678901_lab report.pdf',
      ResponseContentDisposition: 'attachment; filename="lab report.pdf"',
      ResponseContentType: 'application/pdf',
    });
  });

  it('uploads with server-side encryption', async () => {
    const result = await uploadFile({
      originalname: 'scan.png',
      buffer: Buffer.from('png'),
      mimetype: 'image/png',
      size: 3,
    });
    expect(result.success).toBe(true);
    const put = sent.find((command) => command.constructor.name === 'PutObjectCommand');
    expect(put.input).toMatchObject({ Bucket: 'medflow-docs', ServerSideEncryption: 'AES256', ContentType: 'image/png' });
    expect(put.input.Key).toMatch(/^documents\/\d+_scan\.png$/);
  });

  it('reports a signing failure instead of throwing', async () => {
    getSignedUrl.mockRejectedValueOnce(new Error('no credentials'));
    expect(await getDownloadUrl('x.pdf')).toEqual({ success: false, error: 'no credentials' });
  });

  it('has no public URL with local storage', async () => {
    config.storage.driver = 'local';
    try {
      expect(await getDownloadUrl('x.pdf')).toEqual({ success: true, local: true });
    } finally {
      config.storage.driver = 's3';
    }
  });
});

describe('download file names', () => {
  it('strips the timestamp prefix and unsafe header characters', () => {
    expect(originalFileName('1712345678901_blood test.pdf')).toBe('blood test.pdf');
    expect(contentDisposition('evil"\r\nSet-Cookie: x.pdf')).toBe('attachment; filename="evil___Set-Cookie_ x.pdf"');
  });
});
