// Client-side speech recognition utility
export class SpeechRecognitionService {
  private recognition: any;
  private isListening: boolean = false;
  private shouldContinueListening: boolean = false;
  private onResult: (text: string) => void;
  private onError: (error: string) => void;
  private restartTimeout: NodeJS.Timeout | null = null;

  constructor(onResult: (text: string) => void, onError: (error: string) => void) {
    this.onResult = onResult;
    this.onError = onError;
    this.initializeRecognition();
  }

  private initializeRecognition() {
    // Check if browser supports speech recognition
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      this.onError('Speech recognition not supported in this browser');
      return;
    }

    // Create speech recognition instance
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();

    // Configure recognition settings for natural conversation
    this.recognition.continuous = false; // We'll handle continuous listening manually
    this.recognition.interimResults = true; // Get interim results for better UX
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    // Set up event handlers
    this.recognition.onstart = () => {
      this.isListening = true;
      console.log('Speech recognition started');
    };

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      // Process all results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Only process final results
      if (finalTranscript.trim()) {
        console.log('Final transcript:', finalTranscript);
        this.onResult(finalTranscript.trim());
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      // Clear any pending restart
      if (this.restartTimeout) {
        clearTimeout(this.restartTimeout);
        this.restartTimeout = null;
      }

      let shouldStop = false;
      let errorMessage = event.error;
      
      switch (event.error) {
        case 'not-allowed':
          errorMessage = 'Microphone access denied. Please allow microphone access and refresh the page.';
          shouldStop = true;
          break;
        case 'no-speech':
          // Don't show error for no-speech, just continue
          console.log('No speech detected, continuing...');
          this.restartListening();
          return;
        case 'audio-capture':
          errorMessage = 'No microphone found. Please check your microphone connection.';
          shouldStop = true;
          break;
        case 'network':
          errorMessage = 'Network error. Please check your internet connection.';
          shouldStop = true;
          break;
        case 'aborted':
          // Don't show error for aborted (user stopped manually)
          return;
        default:
          console.log('Unknown error, continuing...');
          this.restartListening();
          return;
      }
      
      if (shouldStop) {
        this.shouldContinueListening = false;
        this.onError(errorMessage);
      }
      
      this.isListening = false;
    };

    this.recognition.onend = () => {
      this.isListening = false;
      console.log('Speech recognition ended');
      
      // Always restart if we should continue listening
      if (this.shouldContinueListening) {
        this.restartListening();
      }
    };
  }

  private restartListening() {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    
    this.restartTimeout = setTimeout(() => {
      if (this.shouldContinueListening && this.recognition) {
        try {
          console.log('Restarting speech recognition...');
          this.recognition.start();
        } catch (error) {
          console.error('Error restarting speech recognition:', error);
          // Try again after a longer delay
          this.restartTimeout = setTimeout(() => {
            if (this.shouldContinueListening) {
              this.restartListening();
            }
          }, 1000);
        }
      }
    }, 100);
  }

  public async startListening(): Promise<void> {
    if (this.recognition && !this.isListening) {
      try {
        // Request microphone permission first
        await navigator.mediaDevices.getUserMedia({ audio: true });
        this.shouldContinueListening = true;
        this.recognition.start();
      } catch (error: any) {
        console.error('Microphone access error:', error);
        this.shouldContinueListening = false;
        if (error.name === 'NotAllowedError') {
          this.onError('Microphone access denied. Please allow microphone access and try again.');
        } else if (error.name === 'NotFoundError') {
          this.onError('No microphone found. Please check your microphone connection.');
        } else {
          this.onError('Failed to access microphone. Please check your device settings.');
        }
      }
    }
  }

  public stopListening(): void {
    this.shouldContinueListening = false;
    
    // Clear any pending restart
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  public isCurrentlyListening(): boolean {
    return this.isListening;
  }

  public setLanguage(lang: string): void {
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }
}

// TypeScript declarations for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

