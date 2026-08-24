import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { MedicalDocument } from '../models/index.js';
import { getFile } from '../services/storageService.js';
import { vectorStore } from '../services/vectorStoreService.js';
import { extractText } from '../utils/pdfExtractor.js';
import { chunkText } from '../utils/textChunker.js';
import { llmClient } from '../ai/llmClient.js';
import { logger } from '../utils/logger.js';

// Full processing pipeline for one uploaded document:
// fetch file -> extract text -> chunk -> embed & store -> summarize -> mark done
const processDocument = async (job) => {
  const { documentId } = job.data;
  logger.info(`⚙️  Processing document ${documentId} (job ${job.id}, attempt ${job.attemptsMade + 1})`);

  const document = await MedicalDocument.findById(documentId);
  if (!document) {
    throw new Error(`Document ${documentId} not found`);
  }

  document.processingStatus = 'processing';
  await document.save();

  try {
    const file = await getFile(document.fileName);
    if (!file.success) {
      throw new Error(`Could not read stored file: ${file.error}`);
    }

    const extraction = await extractText(file.data, document.mimeType);
    if (!extraction.success) {
      throw new Error(extraction.error);
    }

    // Re-processing after a retry must not leave duplicate chunks behind.
    await vectorStore.deleteDocument(document._id);

    const chunks = chunkText(extraction.text);
    if (chunks.length === 0) {
      throw new Error('No text could be extracted from the document');
    }

    for (let i = 0; i < chunks.length; i++) {
      const result = await vectorStore.addDocument(chunks[i], {
        documentId: document._id,
        patientId: document.patientId,
        chunkIndex: i,
        fileName: document.fileName,
      });
      if (!result.success) {
        throw new Error(`Failed to store chunk ${i}: ${result.error}`);
      }
      await job.updateProgress(Math.round(((i + 1) / chunks.length) * 90));
    }

    // Short AI summary shown in the document list. Non-critical: skip on failure.
    let summary = '';
    try {
      summary = await llmClient.chat([
        {
          role: 'system',
          content: 'Summarize this medical document in 2-3 plain-language sentences for the patient. Do not add information that is not in the document.',
        },
        { role: 'user', content: extraction.text.slice(0, 8000) },
      ]);
    } catch (error) {
      logger.warn(`Summary generation failed for ${documentId}: ${error.message}`);
    }

    document.extractedText = extraction.text;
    document.summary = summary;
    document.chunkCount = chunks.length;
    document.isProcessed = true;
    document.processingStatus = 'completed';
    document.processingError = undefined;
    await document.save();
    await job.updateProgress(100);

    logger.info(`✅ Document ${documentId} processed: ${chunks.length} chunks`);
    return { chunks: chunks.length, pages: extraction.pages };
  } catch (error) {
    document.processingStatus = 'failed';
    document.processingError = error.message;
    await document.save();
    throw error; // rethrow so BullMQ retries
  }
};

export const startDocumentWorker = () => {
  const worker = new Worker('document-processing', processDocument, {
    connection: createRedisConnection('document-worker'),
    concurrency: 2,
  });

  worker.on('completed', (job) => logger.info(`✅ Document job ${job.id} completed`));
  worker.on('failed', (job, error) =>
    logger.error(`❌ Document job ${job?.id} failed: ${error.message}`)
  );

  logger.info('👷 Document worker started');
  return worker;
};
