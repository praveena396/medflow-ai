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

const driver = config.storage.driver === 's3' ? s3Driver : localDriver;

// ---------- public API (same shape the rest of the app already uses) ----------
export const uploadFile = async (file, subfolder = 'documents') => {
  try {
    if (!file) throw new Error('No file provided');

    const stored = await driver.upload(file, subfolder);
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
    await driver.delete(fileName, subfolder);
    logger.info(`File deleted: ${fileName}`);
    return { success: true, message: 'File deleted successfully' };
  } catch (error) {
    logger.error('File delete error:', error.message);
    return { success: false, error: error.message };
  }
};

export const getFile = async (fileName, subfolder = 'documents') => {
  try {
    const data = await driver.get(fileName, subfolder);
    return { success: true, data, fileName };
  } catch (error) {
    logger.error('File read error:', error.message);
    return { success: false, error: error.message };
  }
};
