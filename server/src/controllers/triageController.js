import { ragChain } from '../ai/ragChain.js';
import { Triage } from '../models/index.js';
import { logger } from '../utils/logger.js';

export const submitSymptoms = async (req, res) => {
  try {
    const { symptoms, duration, severity } = req.body;
    const { userId } = req.user;

    if (!symptoms) {
      return res.status(400).json({ message: 'Symptoms are required' });
    }

    // Process symptoms with RAG triage
    const triageResult = await ragChain.triageSymptoms(symptoms);

    if (!triageResult.success) {
      return res.status(500).json({ message: 'Triage failed' });
    }

    // Persist the triage assessment
    const triageRecord = new Triage({
      patientId: userId,
      symptoms,
      duration,
      severity,
      urgency: triageResult.urgency,
      recommendation: triageResult.recommendation,
      nextSteps: triageResult.nextSteps,
    });
    await triageRecord.save();

    logger.info(`🏥 Triage submitted by user: ${userId} - Urgency: ${triageResult.urgency}`);

    res.json({
      message: 'Triage assessment completed',
      triage: {
        id: triageRecord._id,
        urgency: triageResult.urgency,
        recommendation: triageResult.recommendation,
        nextSteps: triageResult.nextSteps,
        symptoms: symptoms,
        duration,
        severity,
        timestamp: triageRecord.createdAt,
      },
    });
  } catch (error) {
    logger.error('Triage submission error:', error.message);
    res.status(500).json({ message: 'Failed to process triage', error: error.message });
  }
};

export const getTriageHistory = async (req, res) => {
  try {
    const { userId } = req.user;

    const triages = await Triage.find({ patientId: userId }).sort({ createdAt: -1 });

    res.json({
      message: 'Triage history retrieved',
      triages,
    });
  } catch (error) {
    logger.error('Get triage history error:', error.message);
    res.status(500).json({ message: 'Failed to fetch triage history' });
  }
};
