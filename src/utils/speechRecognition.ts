// Client-side speech recognition utility
export class SpeechRecognitionService {
  private recognition: any;
  private isListening: boolean = false;
  private shouldContinueListening: boolean = false;
  private onResult: (text: string) => void;
  private onError: (error: string) => void;

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

    // Configure recognition settings
    this.recognition.continuous = true; // Keep listening continuously
    this.recognition.interimResults = false; // Only return final results
    this.recognition.lang = 'en-US'; // Set language
    this.recognition.maxAlternatives = 1; // Only return best result

    // Set up event handlers
    this.recognition.onstart = () => {
      this.isListening = true;
      console.log('Speech recognition started');
    };

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      this.onResult(transcript);
      // Don't set isListening = false here since we want continuous listening
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      let errorMessage = event.error;
      if (event.error === 'not-allowed') {
        errorMessage = 'Microphone access denied. Please allow microphone access and refresh the page.';
        this.shouldContinueListening = false; // Stop trying on permission errors
      } else if (event.error === 'no-speech') {
        errorMessage = 'No speech detected. Please try again.';
        // Don't stop on no-speech errors, just continue
      } else if (event.error === 'audio-capture') {
        errorMessage = 'No microphone found. Please check your microphone connection.';
        this.shouldContinueListening = false; // Stop trying on hardware errors
      } else if (event.error === 'network') {
        errorMessage = 'Network error. Please check your internet connection.';
        this.shouldContinueListening = false; // Stop trying on network errors
      } else if (event.error === 'aborted') {
        // Don't show error for aborted (user stopped manually)
        return;
      }
      
      this.onError(errorMessage);
      this.isListening = false;
    };

    this.recognition.onend = () => {
      this.isListening = false;
      console.log('Speech recognition ended');
      
      // If we should continue listening, restart the recognition
      if (this.shouldContinueListening) {
        console.log('Restarting speech recognition...');
        setTimeout(() => {
          if (this.shouldContinueListening && this.recognition) {
            try {
              this.recognition.start();
            } catch (error) {
              console.error('Error restarting speech recognition:', error);
              this.shouldContinueListening = false;
            }
          }
        }, 100); // Small delay to prevent rapid restarts
      }
    };
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

