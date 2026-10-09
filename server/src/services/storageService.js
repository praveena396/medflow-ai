import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Storage drivers share one interface: upload / delete / get.
// FILE_STORAGE_TYPE=local (dev) or s3 (AWS S3 / MinIO) — callers never know which.

// ---------- local disk driver ----------
const localDriver = {
  ensureDir(subfolder) {
    const folder = path.join(config.storage.uploadDir, subfolder);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
  },

  async upload(file, subfolder) {
    const folder = this.ensureDir(subfolder);
    const fileName = `${Date.now()}_${file.originalname}`;
    const filePath = path.join(folder, fileName);
    await fs.promises.writeFile(filePath, file.buffer);
    return {
      fileName,
      filePath: filePath.replace(/\\/g, '/'),
      url: `/uploads/${subfolder}/${fileName}`,
    };
  },

  async delete(fileName, subfolder) {
    const filePath = path.join(config.storage.uploadDir, subfolder, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }
    await fs.promises.unlink(filePath);
  },

  async get(fileName, subfolder) {
    const filePath = path.join(config.storage.uploadDir, subfolder, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }
    return fs.promises.readFile(filePath);
  },
};

// ---------- S3-compatible driver (AWS S3, MinIO, ...) ----------
let s3Client = null;
const getS3 = async () => {
  // Lazy import so @aws-sdk/client-s3 is only required when the driver is used.
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } =
    await import('@aws-sdk/client-s3');
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.storage.s3.region,
      endpoint: config.storage.s3.endpoint,
      forcePathStyle: Boolean(config.storage.s3.endpoint), // required for MinIO
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
      },
    });
  }
  return { s3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand };
};

const s3Driver = {
  async upload(file, subfolder) {
    const { s3Client, PutObjectCommand } = await getS3();
    const fileName = `${Date.now()}_${file.originalname}`;
    const key = `${subfolder}/${fileName}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.storage.s3.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ServerSideEncryption: 'AES256',
      })
    );
    return { fileName, filePath: key, url: key };
  },

  async delete(fileName, subfolder) {
    const { s3Client, DeleteObjectCommand } = await getS3();
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.storage.s3.bucket,
        Key: `${subfolder}/${fileName}`,
      })
    );
  },

  // A short-lived link the browser can fetch directly from S3; the app never
  // proxies the bytes and the bucket can stay private.
  async getDownloadUrl(fileName, subfolder, { expiresIn, downloadName, contentType }) {
    const { s3Client, GetObjectCommand } = await getS3();
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: `${subfolder}/${fileName}`,
      ResponseContentDisposition: contentDisposition(downloadName),
      ...(contentType && { ResponseContentType: contentType }),
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  },

  async get(fileName, subfolder) {
    const { s3Client, GetObjectCommand } = await getS3();
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.storage.s3.bucket,
        Key: `${subfolder}/${fileName}`,
      })
    );
    return Buffer.from(await response.Body.transformToByteArray());
  },
};

// Chosen per call (not at import) so the driver follows the current config.
const getDriver = () => (config.storage.driver === 's3' ? s3Driver : localDriver);

// Stored names are "<timestamp>_<original name>"; downloads use the original.
export const originalFileName = (storedName) => String(storedName).replace(/^\d+_/, '');

// Only safe characters in the header value, so a crafted file name can't
// inject headers or break the quoting.
export const contentDisposition = (fileName) =>
  `attachment; filename="${String(fileName || 'download').replace(/[^\w.\- ()]/g, '_').slice(0, 150)}"`;

// ---------- public API (same shape the rest of the app already uses) ----------
export const uploadFile = async (file, subfolder = 'documents') => {
  try {
    if (!file) throw new Error('No file provided');

    const stored = await getDriver().upload(file, subfolder);
    logger.info(`File uploaded via ${config.storage.driver} driver: ${stored.fileName}`);

    return {
      success: true,
      ...stored,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  } catch (error) {
    logger.error('File upload error:', error.message);
    return { success: false, error: error.message };
  }
};

export const deleteFile = async (fileName, subfolder = 'documents') => {
  try {
    await getDriver().delete(fileName, subfolder);
    logger.info(`File deleted: ${fileName}`);
    return { success: true, message: 'File deleted successfully' };
  } catch (error) {
    logger.error('File delete error:', error.message);
    return { success: false, error: error.message };
  }
};

export const getFile = async (fileName, subfolder = 'documents') => {
  try {
    const data = await getDriver().get(fileName, subfolder);
    return { success: true, data, fileName };
  } catch (error) {
    logger.error('File read error:', error.message);
    return { success: false, error: error.message };
  }
};

// Download link for a stored file. With the S3 driver this is a pre-signed
// URL valid for config.storage.downloadUrlExpirySeconds (15 minutes by
// default). Local storage has no public URL: callers stream the file through
// an authenticated route instead ({ local: true }).
export const getDownloadUrl = async (fileName, { subfolder = 'documents', contentType } = {}) => {
  if (config.storage.driver !== 's3') return { success: true, local: true };
  try {
    const expiresIn = config.storage.downloadUrlExpirySeconds;
    const url = await s3Driver.getDownloadUrl(fileName, subfolder, {
      expiresIn,
      downloadName: originalFileName(fileName),
      contentType,
    });
    return { success: true, url, expiresIn };
  } catch (error) {
    logger.error('Pre-signed URL error:', error.message);
    return { success: false, error: error.message };
  }
};
