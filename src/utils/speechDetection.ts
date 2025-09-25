// Speech detection service for interrupting avatar when user starts speaking
export class SpeechDetectionService {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private isDetecting: boolean = false;
  private onSpeechDetected: () => void;
  private onSpeechEnd?: () => void;
  private animationFrame: number | null = null;
  private cleanupHandlers: Array<() => void> = [];
  
  // Speech detection parameters (mutable to allow runtime tuning)
  private SPEECH_THRESHOLD = 0.01; // Adjust based on testing
  private SILENCE_DURATION = 1000; // ms of silence before considering speech ended
  private MIN_SPEECH_DURATION = 200; // ms of speech before triggering
  
  private speechStartTime: number | null = null;
  private lastSpeechTime: number = 0;
  private isCurrentlySpeaking: boolean = false;

  constructor(onSpeechDetected: () => void, onSpeechEnd?: () => void) {
    this.onSpeechDetected = onSpeechDetected;
    this.onSpeechEnd = onSpeechEnd;
  }

  public async startDetection(): Promise<void> {
    if (this.isDetecting) {
      console.log('Speech detection already active');
      return;
    }

    try {
      // Request microphone access (tune constraints for Android)
      const isAndroid = this.isAndroid();
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: isAndroid ? false : true,
          noiseSuppression: isAndroid ? false : true,
          autoGainControl: isAndroid ? false : true,
          channelCount: 1
        }
      });

      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      await this.resumeAudioContextIfNeeded();
      this.configurePlatformDefaults();
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);

      // On Android, explicitly disable track-level processing that can zero low levels
      try {
        const track = this.stream.getAudioTracks()[0];
        if (track && isAndroid && track.applyConstraints) {
          await track.applyConstraints({
            echoCancellation: false as any,
            noiseSuppression: false as any,
            autoGainControl: false as any
          } as any);
        }
      } catch {}

      // Configure analyser
      this.analyser.fftSize = 1024; // Larger window helps stabilize RMS on Android
      this.analyser.smoothingTimeConstant = 0.6;
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

    // Clean up listeners
    if (this.cleanupHandlers.length) {
      this.cleanupHandlers.forEach(dispose => {
        try { dispose(); } catch {}
      });
      this.cleanupHandlers = [];
    }

    console.log('Speech detection stopped');
  }

  private startAnalysis(): void {
    if (!this.analyser || !this.isDetecting) {
      return;
    }

    // Use time-domain RMS which is more reliable on Android than frequency averages
    const timeDomain = new Uint8Array(this.analyser.fftSize);
    let noiseFloor = this.isAndroid() ? 0.0015 : 0.005; // adaptive baseline
    const noiseSmoothing = 0.95;
    
    const analyze = () => {
      if (!this.isDetecting || !this.analyser) {
        return;
      }

      this.analyser.getByteTimeDomainData(timeDomain);
      
      // Compute RMS from time-domain data (0..1)
      let sumSquares = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const v = (timeDomain[i] - 128) / 128; // center around 0
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / timeDomain.length);
      
      // Adaptive noise floor to handle different device mic baselines
      noiseFloor = noiseSmoothing * noiseFloor + (1 - noiseSmoothing) * rms;
      const levelAboveNoise = Math.max(0, rms - noiseFloor);
      const normalizedVolume = levelAboveNoise;
      // Debug: uncomment for tuning
      // console.log('RMS', rms.toFixed(4), 'NF', noiseFloor.toFixed(4), 'LV', normalizedVolume.toFixed(4));

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
            if (this.onSpeechEnd) {
              try { this.onSpeechEnd(); } catch {}
            }
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

  private isAndroid(): boolean {
    return /Android/i.test(navigator.userAgent || '');
  }

  private async resumeAudioContextIfNeeded(): Promise<void> {
    if (!this.audioContext) return;
    const tryResume = async () => {
      if (!this.audioContext) return;
      if (this.audioContext.state === 'suspended') {
        try { await this.audioContext.resume(); } catch {}
      }
    };

    await tryResume();

    // Resume on interactions/visibility changes (common on Android)
    const onInteract = () => { tryResume(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') { tryResume(); } };
    window.addEventListener('touchstart', onInteract, { passive: true } as any);
    window.addEventListener('click', onInteract, { passive: true } as any);
    document.addEventListener('visibilitychange', onVisibility);

    this.cleanupHandlers.push(() => window.removeEventListener('touchstart', onInteract));
    this.cleanupHandlers.push(() => window.removeEventListener('click', onInteract));
    this.cleanupHandlers.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  private configurePlatformDefaults(): void {
    // Android often reports lower RMS; relax thresholds slightly
    if (this.isAndroid()) {
      this.SPEECH_THRESHOLD = Math.max(0.002, this.SPEECH_THRESHOLD * 0.6);
      this.MIN_SPEECH_DURATION = Math.min(350, Math.max(150, this.MIN_SPEECH_DURATION));
    }
  }
}

