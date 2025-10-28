import axios from 'axios';

// Types for API responses
export interface SessionTokenResponse {
  data: {
    token: string;
  };
}

export interface SessionInfo {
  session_id: string;
  url: string;
  access_token: string;
}

export interface NewSessionResponse {
  data: SessionInfo;
}

export interface StreamingTaskResponse {
  data: any;
}

// Configuration
const API_CONFIG = {
  serverUrl: 'https://api.heygen.com',
  apiKey: import.meta.env.VITE_HEYGEN_API_KEY,
};

// Get session token
export const getSessionToken = async (): Promise<SessionTokenResponse> => {
  try {
    const response = await axios.post(
      `${API_CONFIG.serverUrl}/v1/streaming.create_token`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': API_CONFIG.apiKey,
        },
      }
    );
    return response.data;
  } catch (err) {
    throw err;
  }
};

// Create new session
export const createNewSession = async (
  sessionToken: string,
  avatarId: string,
  voiceId: string
): Promise<NewSessionResponse> => {
  try {
    const response = await axios.post(
      `${API_CONFIG.serverUrl}/v1/streaming.new`,
      {
        quality: 'high',
        avatar_name: avatarId,
        voice: {
          voice_id: voiceId,
          rate: 1.0,
        },
        language: 'English',
        emotion: 'Excited',
        version: 'v2',
        video_encoding: 'H264',
        knowledge_base_id: '0c7b7d8a5f214a97906006dc2c9f0335',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );
    return response.data;
  } catch (err) {
    throw err;
  }
};

// Start streaming session
export const startStreamingSession = async (
  sessionToken: string,
  sessionId: string
): Promise<any> => {
  try {
    const response = await axios.post(
      `${API_CONFIG.serverUrl}/v1/streaming.start`,
      {
        session_id: sessionId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );
    return response.data;
  } catch (err) {
    throw err;
  }
};

// Send text to avatar
export const sendTextToAvatar = async (
  sessionToken: string,
  sessionId: string,
  text: string,
  taskType: string = 'talk'
): Promise<StreamingTaskResponse> => {
  try {
    const response = await axios.post(
      `${API_CONFIG.serverUrl}/v1/streaming.task`,
      {
        session_id: sessionId,
        text: text,
        task_type: taskType,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );
    return response.data;
  } catch (err) {
    throw err;
  }
};

// Stop streaming session
export const stopStreamingSession = async (
  sessionToken: string,
  sessionId: string
): Promise<any> => {
  try {
    const response = await axios.post(
      `${API_CONFIG.serverUrl}/v1/streaming.stop`,
      {
        session_id: sessionId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );
    return response.data;
  } catch (err) {
    throw err;
  }
};

// Legacy function for backward compatibility
export const getAccessToken = getSessionToken;