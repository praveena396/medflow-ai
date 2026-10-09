import { ChatHistory } from '../models/index.js';
import { ragChain } from '../ai/ragChain.js';
import { logger } from '../utils/logger.js';
import { recordAudit } from '../services/auditService.js';

export const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const { userId } = req.user;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message is required' });
    }

    // Get or create chat session
    let chatHistory = await ChatHistory.findOne({
      patientId: userId,
      isActive: true,
    });

    if (!chatHistory) {
      chatHistory = new ChatHistory({
        patientId: userId,
        messages: [],
      });
    }

    // Add user message
    chatHistory.messages.push({
      sender: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Process message with RAG, scoped to this patient's own documents
    const ragResponse = await ragChain.processQuery(message, { patientId: userId });

    // Add bot response
    chatHistory.messages.push({
      sender: 'bot',
      content: ragResponse.message,
      sourceDocument: ragResponse.sourceDocuments?.[0]?.fileName,
      confidence: ragResponse.confidence,
      timestamp: new Date(),
    });

    // Save chat history
    await chatHistory.save();

    // Every AI output is audited, including declines and failures.
    await recordAudit({
      req,
      action: !ragResponse.success
        ? 'ai.chat.error'
        : ragResponse.declined
          ? 'ai.chat.declined'
          : 'ai.chat.answer',
      targetType: 'chat',
      targetId: chatHistory._id,
      details: {
        question: message,
        answer: ragResponse.message,
        confidence: ragResponse.confidence,
        ...(ragResponse.declineReason && { declineReason: ragResponse.declineReason }),
        sources: (ragResponse.sourceDocuments || []).map((doc) => doc.fileName),
        ...(ragResponse.error && { error: ragResponse.error }),
      },
    });

    logger.info(`💬 Chat message processed for user: ${userId}`);

    res.json({
      message: 'Message processed',
      response: {
        text: ragResponse.message,
        sourceDocuments: ragResponse.sourceDocuments,
        confidence: ragResponse.confidence,
        // true when the patient's documents don't contain an answer
        declined: ragResponse.declined === true,
        // 'low-similarity' (nothing close enough) or 'not-grounded' (close, but
        // the excerpts don't state the answer); absent when answered
        ...(ragResponse.declineReason && { declineReason: ragResponse.declineReason }),
      },
    });
  } catch (error) {
    logger.error('Chat error:', error.message);
    res.status(500).json({ message: 'Failed to process message', error: error.message });
  }
};

export const getChatHistory = async (req, res) => {
  try {
    const { userId } = req.user;

    const chatHistory = await ChatHistory.findOne({
      patientId: userId,
      isActive: true,
    });

    if (!chatHistory) {
      return res.json({
        messages: [],
        message: 'No chat history found',
      });
    }

    res.json({
      messages: chatHistory.messages,
      sessionStarted: chatHistory.sessionStarted,
    });
  } catch (error) {
    logger.error('Get chat history error:', error.message);
    res.status(500).json({ message: 'Failed to fetch chat history' });
  }
};

export const clearChatHistory = async (req, res) => {
  try {
    const { userId } = req.user;

    await ChatHistory.findOneAndUpdate(
      { patientId: userId },
      { isActive: false }
    );

    logger.info(`🧹 Chat history cleared for user: ${userId}`);

    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    logger.error('Clear chat error:', error.message);
    res.status(500).json({ message: 'Failed to clear chat history' });
  }
};
