// Client-side speech recognition utility
export class SpeechRecognitionService {
  private recognition: any;
  private isListening: boolean = false;
  private onResult: (text: string) => void;
  private onError: (error: string) => void;
  private onInterrupt: (() => void) | null = null;
  private accumulatedText: string = '';
  private speechTimeout: any = null;
  private isAvatarSpeaking: boolean = false;
  private lastInterruptTime: number = 0;
  private interruptDebounceMs: number = 1000; // 1 second debounce

  constructor(onResult: (text: string) => void, onError: (error: string) => void, onInterrupt?: () => void) {
    this.onResult = onResult;
    this.onError = onError;
    this.onInterrupt = onInterrupt || null;
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
    this.recognition.interimResults = true; // Get interim results to accumulate speech
    this.recognition.lang = 'en-US'; // Set language
    this.recognition.maxAlternatives = 1; // Only return best result

    // Set up event handlers
    this.recognition.onstart = () => {
      this.isListening = true;
      console.log('Speech recognition started');
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';
      
      // Process all results to accumulate speech
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Check for user interruption if avatar is speaking (with debounce)
      if (this.isAvatarSpeaking && (interimTranscript.trim().length > 0 || finalTranscript.trim().length > 0)) {
        const currentTime = Date.now();
        if (currentTime - this.lastInterruptTime > this.interruptDebounceMs) {
          console.log('User interruption detected while avatar is speaking');
          this.lastInterruptTime = currentTime;
          if (this.onInterrupt) {
            this.onInterrupt();
          }
        } else {
          console.log('Interrupt debounced - too soon since last interrupt');
        }
      }
      
      // Also check for interruption on interim results (more responsive)
      if (this.isAvatarSpeaking && interimTranscript.trim().length > 2) {
        const currentTime = Date.now();
        if (currentTime - this.lastInterruptTime > this.interruptDebounceMs) {
          console.log('User interruption detected via interim results while avatar is speaking');
          this.lastInterruptTime = currentTime;
          if (this.onInterrupt) {
            this.onInterrupt();
          }
        }
      }
      
      // Update accumulated text with final results
      if (finalTranscript.trim().length > 0) {
        this.accumulatedText += finalTranscript;
        console.log('Final transcript added:', finalTranscript);
        console.log('Accumulated text so far:', this.accumulatedText);
        
        // Check if the sentence seems complete (ends with punctuation or pause)
        if (this.isSentenceComplete(this.accumulatedText)) {
          console.log('Sentence complete, processing:', this.accumulatedText);
          this.onResult(this.accumulatedText.trim());
          this.accumulatedText = ''; // Reset for next sentence
        }
      }
      
      // Clear any existing timeout and set a new one for interim results
      if (interimTranscript.trim().length > 0) {
        if (this.speechTimeout) {
          clearTimeout(this.speechTimeout);
        }
        
        // Set timeout to process accumulated text if user stops speaking
        this.speechTimeout = setTimeout(() => {
          if (this.accumulatedText.trim().length > 0) {
            console.log('Speech timeout reached, processing accumulated text:', this.accumulatedText);
            this.onResult(this.accumulatedText.trim());
            this.accumulatedText = '';
          }
        }, 2000); // 2 seconds of silence before processing
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      let errorMessage = event.error;
      let shouldRestart = false;
      
      if (event.error === 'not-allowed') {
        errorMessage = 'Microphone access denied. Please allow microphone access and refresh the page.';
      } else if (event.error === 'no-speech') {
        errorMessage = 'No speech detected. Please try again.';
        shouldRestart = true; // Restart for no-speech errors
      } else if (event.error === 'audio-capture') {
        errorMessage = 'No microphone found. Please check your microphone connection.';
      } else if (event.error === 'network') {
        errorMessage = 'Network error. Please check your internet connection.';
        shouldRestart = true; // Restart for network errors
      } else if (event.error === 'aborted') {
        console.log('Speech recognition aborted - this is normal, will restart automatically');
        shouldRestart = true; // Restart for aborted errors (common with continuous listening)
        return; // Don't show error for aborted, just restart
      } else if (event.error === 'service-not-allowed') {
        errorMessage = 'Speech recognition service not allowed. Please check your browser settings.';
      } else {
        shouldRestart = true; // Restart for other errors
      }
      
      if (!shouldRestart) {
        this.onError(errorMessage);
      }
      
      this.isListening = false;
      this.clearAccumulatedText(); // Clear any accumulated text on error
      
      // Auto-restart for recoverable errors
      if (shouldRestart) {
        setTimeout(() => {
          if (!this.isListening) {
            console.log('Auto-restarting speech recognition after error...');
            this.startListening().catch(console.error);
          }
        }, 1000);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      console.log('Speech recognition ended - restarting...');
      
      // Process any remaining accumulated text before restarting
      if (this.accumulatedText.trim().length > 0) {
        console.log('Processing remaining accumulated text on end:', this.accumulatedText);
        this.onResult(this.accumulatedText.trim());
        this.accumulatedText = '';
      }
      
      // Automatically restart listening after a short delay
      setTimeout(() => {
        if (!this.isListening) {
          console.log('Auto-restarting speech recognition from onend...');
          this.startListening().catch((error) => {
            console.error('Failed to restart speech recognition:', error);
            // Try again after a longer delay if restart fails
            setTimeout(() => {
              if (!this.isListening) {
                this.startListening().catch(console.error);
              }
            }, 3000);
          });
        }
      }, 500); // Shorter delay for faster restart
    };
  }

  public async startListening(): Promise<void> {
    if (this.recognition && !this.isListening) {
      try {
        // Request microphone permission first
        await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Starting speech recognition...');
        this.recognition.start();
      } catch (error: any) {
        console.error('Microphone access error:', error);
        if (error.name === 'NotAllowedError') {
          this.onError('Microphone access denied. Please allow microphone access and try again.');
        } else if (error.name === 'NotFoundError') {
          this.onError('No microphone found. Please check your microphone connection.');
        } else {
          this.onError('Failed to access microphone. Please check your device settings.');
        }
      }
    } else if (this.recognition && this.isListening) {
      console.log('Speech recognition already listening');
    } else {
      console.log('Speech recognition not available');
    }
  }

  public stopListening(): void {
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

  public forceRestart(): void {
    console.log('Force restarting speech recognition...');
    this.isListening = false;
    this.startListening().catch(console.error);
  }

  public isActive(): boolean {
    return this.isListening;
  }

  private isSentenceComplete(text: string): boolean {
    const trimmedText = text.trim();
    
    // Check if text ends with sentence-ending punctuation
    const sentenceEnders = ['.', '!', '?', '。', '！', '？'];
    const endsWithPunctuation = sentenceEnders.some(punct => trimmedText.endsWith(punct));
    
    // Check if text is long enough to be a complete sentence (more than 10 characters)
    const isLongEnough = trimmedText.length > 10;
    
    // Check if text contains common sentence-ending words
    const sentenceEndingWords = ['thanks', 'thank you', 'bye', 'goodbye', 'okay', 'ok', 'done', 'finished', 'complete'];
    const endsWithCommonWords = sentenceEndingWords.some(word => 
      trimmedText.toLowerCase().endsWith(word.toLowerCase())
    );
    
    return endsWithPunctuation || (isLongEnough && endsWithCommonWords) || trimmedText.length > 100;
  }

  public clearAccumulatedText(): void {
    this.accumulatedText = '';
    if (this.speechTimeout) {
      clearTimeout(this.speechTimeout);
      this.speechTimeout = null;
    }
  }

  public setAvatarSpeaking(speaking: boolean): void {
    this.isAvatarSpeaking = speaking;
    console.log('Avatar speaking state set to:', speaking);
  }

  public isAvatarCurrentlySpeaking(): boolean {
    return this.isAvatarSpeaking;
  }

  public setInterruptDebounce(ms: number): void {
    this.interruptDebounceMs = ms;
    console.log('Interrupt debounce set to:', ms, 'ms');
  }
}

// TypeScript declarations for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

