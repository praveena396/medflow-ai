// User types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'patient' | 'doctor' | 'admin';
  createdAt: Date;
}

// The refresh token is not in the body: the API sets it as an httpOnly cookie.
export interface AuthResponse {
  token: string;
  user: User;
}

// Appointment types
export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  dateTime: Date;
  reason: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string;
}

// Chat types
export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  content: string;
  timestamp: Date;
  sourceDocument?: string;
}

// Triage types
export interface TriageRequest {
  symptoms: string;
  duration?: string;
  severity?: number;
}

export interface TriageResponse {
  urgency: 'low' | 'medium' | 'high' | 'critical';
  recommendedCare: string;
  explanation: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
