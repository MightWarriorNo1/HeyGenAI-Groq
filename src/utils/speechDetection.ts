// Speech detection service for interrupting avatar when user starts speaking
export class SpeechDetectionService {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private isDetecting: boolean = false;
  private onSpeechDetected: () => void;
  private animationFrame: number | null = null;
  
  // Speech detection parameters (mutable to allow runtime tuning)
  private SPEECH_THRESHOLD = 0.01; // Adjust based on testing
  private SILENCE_DURATION = 1000; // ms of silence before considering speech ended
  private MIN_SPEECH_DURATION = 200; // ms of speech before triggering
  
  private speechStartTime: number | null = null;
  private lastSpeechTime: number = 0;
  private isCurrentlySpeaking: boolean = false;

  constructor(onSpeechDetected: () => void) {
    this.onSpeechDetected = onSpeechDetected;
  }

  public async startDetection(): Promise<void> {
    if (this.isDetecting) {
      console.log('Speech detection already active');
      return;
    }

    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);

      // Configure analyser
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.microphone.connect(this.analyser);

      this.isDetecting = true;
      this.startAnalysis();
      
      console.log('Speech detection started');
    } catch (error: any) {
      console.error('Failed to start speech detection:', error);
      throw new Error(`Speech detection failed: ${error.message}`);
    }
  }

  public stopDetection(): void {
    if (!this.isDetecting) {
      return;
    }

    this.isDetecting = false;
    this.isCurrentlySpeaking = false;
    this.speechStartTime = null;
    this.lastSpeechTime = 0;

    // Stop analysis
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    // Clean up audio resources
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    console.log('Speech detection stopped');
  }

  private startAnalysis(): void {
    if (!this.analyser || !this.isDetecting) {
      return;
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    const analyze = () => {
      if (!this.isDetecting || !this.analyser) {
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      const normalizedVolume = average / 255;

      const now = Date.now();
      
      // Check if speech is detected
      if (normalizedVolume > this.SPEECH_THRESHOLD) {
        this.lastSpeechTime = now;
        
        if (!this.isCurrentlySpeaking) {
          this.speechStartTime = now;
          this.isCurrentlySpeaking = true;
          console.log('Speech detected - starting timer');
        } else {
          // Check if we've been speaking long enough to trigger interruption
          const speechDuration = now - (this.speechStartTime || now);
          if (speechDuration >= this.MIN_SPEECH_DURATION) {
            console.log('User speech detected - triggering avatar interruption');
            this.onSpeechDetected();
            // Reset to prevent multiple triggers
            this.isCurrentlySpeaking = false;
            this.speechStartTime = null;
          }
        }
      } else {
        // No speech detected
        if (this.isCurrentlySpeaking) {
          const silenceDuration = now - this.lastSpeechTime;
          if (silenceDuration >= this.SILENCE_DURATION) {
            console.log('Speech ended');
            this.isCurrentlySpeaking = false;
            this.speechStartTime = null;
          }
        }
      }

      // Schedule next analysis
      this.animationFrame = requestAnimationFrame(analyze);
    };

    analyze();
  }

  public isActive(): boolean {
    return this.isDetecting;
  }

  public setSpeechThreshold(threshold: number): void {
    this.SPEECH_THRESHOLD = Math.max(0, Math.min(1, threshold));
  }

  public setMinSpeechDuration(duration: number): void {
    this.MIN_SPEECH_DURATION = Math.max(50, duration);
  }
}

