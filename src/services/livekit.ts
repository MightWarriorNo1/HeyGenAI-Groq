// LiveKit service for handling WebRTC connections
// This replaces the SDK functionality with direct LiveKit client usage

export interface LiveKitRoom {
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => void;
  prepareConnection: (url: string, token: string) => Promise<void>;
  on: (event: string, callback: (data: LiveKitTrack | ArrayBuffer | string) => void) => void;
}

export interface LiveKitTrack {
  kind: 'video' | 'audio';
  mediaStreamTrack: MediaStreamTrack;
}

export interface LiveKitClient {
  Room: new (config: unknown) => LiveKitRoom;
  RoomEvent: {
    DataReceived: string;
    TrackSubscribed: string;
    TrackUnsubscribed: string;
    Disconnected: string;
  };
  VideoPresets: {
    h720: {
      resolution: {
        width: number;
        height: number;
      };
    };
  };
}

// Declare global LiveKit client (will be loaded via CDN)
declare global {
  interface Window {
    LivekitClient: LiveKitClient;
  }
}

export class LiveKitService {
  private room: LiveKitRoom | null = null;
  private mediaStream: MediaStream | null = null;
  private isConnected = false;
  private webSocket: WebSocket | null = null;

  constructor() {
    this.loadLiveKitClient();
  }

  private async loadLiveKitClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.LivekitClient) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/livekit-client@2.11.3/dist/livekit-client.umd.min.js';
      script.onload = () => {
        if (window.LivekitClient) {
          resolve();
        } else {
          reject(new Error('Failed to load LiveKit client'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load LiveKit client'));
      document.head.appendChild(script);
    });
  }

  async createRoom(): Promise<LiveKitRoom> {
    await this.loadLiveKitClient();
    
    this.room = new window.LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: window.LivekitClient.VideoPresets.h720.resolution,
      },
    });

    this.mediaStream = new MediaStream();

    // Set up event handlers
    this.setupEventHandlers();

    return this.room;
  }

  private setupEventHandlers(): void {
    if (!this.room) return;

    // Handle room messages
    this.room.on(window.LivekitClient.RoomEvent.DataReceived, (data) => {
      if (data instanceof ArrayBuffer) {
        const message = new TextDecoder().decode(data);
        console.log('Room message:', JSON.parse(message));
      }
    });

    // Handle track subscription
    this.room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (data) => {
      if (typeof data === 'object' && 'kind' in data && 'mediaStreamTrack' in data) {
        const track = data as LiveKitTrack;
        if (track.kind === 'video' || track.kind === 'audio') {
          this.mediaStream?.addTrack(track.mediaStreamTrack);
        }
      }
    });

    // Handle track unsubscription
    this.room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (data) => {
      if (typeof data === 'object' && 'kind' in data && 'mediaStreamTrack' in data) {
        const track = data as LiveKitTrack;
        const mediaTrack = track.mediaStreamTrack;
        if (mediaTrack) {
          this.mediaStream?.removeTrack(mediaTrack);
        }
      }
    });

    // Handle disconnection
    this.room.on(window.LivekitClient.RoomEvent.Disconnected, (data) => {
      if (typeof data === 'string') {
        console.log(`Room disconnected: ${data}`);
        this.isConnected = false;
      }
    });
  }

  async prepareConnection(url: string, token: string): Promise<void> {
    if (!this.room) {
      throw new Error('Room not created');
    }
    await this.room.prepareConnection(url, token);
  }

  async connect(url: string, token: string): Promise<void> {
    if (!this.room) {
      throw new Error('Room not created');
    }
    await this.room.connect(url, token);
    this.isConnected = true;
  }

  async connectWebSocket(sessionId: string, sessionToken: string, openingText?: string): Promise<void> {
    const params = new URLSearchParams({
      session_id: sessionId,
      session_token: sessionToken,
      silence_response: 'false',
      opening_text: openingText || "Hello My name is 6, your personal assistant. How can I help you today?",
      stt_language: 'en',
    });

    const wsUrl = `wss://api.heygen.com/v1/ws/streaming.chat?${params}`;

    this.webSocket = new WebSocket(wsUrl);

    // Handle WebSocket events
    this.webSocket.addEventListener('message', (event) => {
      const eventData = JSON.parse(event.data);
      console.log('Raw WebSocket event:', eventData);
    });

    this.webSocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
    });

    this.webSocket.addEventListener('close', () => {
      console.log('WebSocket connection closed');
    });
  }

  disconnect(): void {
    if (this.room) {
      this.room.disconnect();
      this.isConnected = false;
    }
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  isRoomConnected(): boolean {
    return this.isConnected;
  }

  cleanup(): void {
    this.disconnect();
    this.room = null;
    this.mediaStream = null;
    this.isConnected = false;
  }
}

