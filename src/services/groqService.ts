// Base URL for proxy requests
const GROQ_API_BASE = '/api/groq';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface TranscriptionOptions {
  model?: string;
  file: File;
}

/**
 * Create a chat completion using Groq's API
 */
export const createChatCompletion = async (options: ChatCompletionOptions) => {
  try {
    const response = await fetch(`${GROQ_API_BASE}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || 'llama-3.1-8b-instant',
        messages: options.messages,
        max_tokens: options.max_tokens || 1000,
        temperature: options.temperature || 0.7,
        stream: options.stream || false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error creating chat completion:', error);
    throw error;
  }
};

/**
 * Create a streaming chat completion using Groq's API
 */
export const createStreamingChatCompletion = async (options: ChatCompletionOptions) => {
  try {
    const response = await fetch(`${GROQ_API_BASE}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || 'llama-3.1-8b-instant',
        messages: options.messages,
        max_tokens: options.max_tokens || 1000,
        temperature: options.temperature || 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    return response;
  } catch (error) {
    console.error('Error creating streaming chat completion:', error);
    throw error;
  }
};

/**
 * Transcribe audio using Groq's Whisper model
 */
export const transcribeAudio = async (options: TranscriptionOptions) => {
  try {
    const formData = new FormData();
    formData.append('file', options.file);
    formData.append('model', options.model || 'whisper-large-v3');

    const response = await fetch(`${GROQ_API_BASE}/openai/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      text: result.text || ''
    };
  } catch (error) {
    console.error('Error transcribing audio with Groq:', error);
    throw error;
  }
};

/**
 * Translate audio to English using Groq's Whisper model
 */
export const translateAudio = async (options: TranscriptionOptions) => {
  try {
    const formData = new FormData();
    formData.append('file', options.file);
    formData.append('model', options.model || 'whisper-large-v3');

    const response = await fetch(`${GROQ_API_BASE}/openai/v1/audio/translations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      text: result.text || ''
    };
  } catch (error) {
    console.error('Error translating audio with Groq:', error);
    throw error;
  }
};

/**
 * Generate dynamic buttons based on conversation context
 */
export const generateDynamicButtons = async (conversation: ChatMessage[]) => {
  try {
    const response = await createChatCompletion({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'Generate 4 witty button prompts (1-3 words each) based on conversation. Return only the 4 button texts, one per line.'
        },
        {
          role: 'user',
          content: `Context: ${conversation.slice(-1).map(msg => msg.content).join(' ')}`
        }
      ],
      max_tokens: 60,
      temperature: 0.6
    });
    
    const buttons = (response as { choices: Array<{ message: { content?: string } }> }).choices[0].message.content?.split('\n').filter((btn: string) => btn.trim()) || [];
    return buttons;
  } catch (error) {
    console.error('Error generating dynamic buttons:', error);
    // Return fallback buttons
    return [
      "🤔 Mind-Bending Mysteries",
      "💰 Money Magic & Mayhem", 
      "💕 Love & Laughter Therapy",
      "🎭 Life's Comedy Coach"
    ];
  }
};

/**
 * Analyze image using Groq's vision capabilities
 */
export const analyzeImage = async (imageData: string, prompt: string) => {
  try {
    const response = await fetch(`${GROQ_API_BASE}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.2-90b-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageData}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      content: result.choices[0].message.content || ''
    };
  } catch (error) {
    console.error('Error analyzing image with Groq:', error);
    throw error;
  }
};
