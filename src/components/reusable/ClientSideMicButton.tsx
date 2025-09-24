import { FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import { SpeechRecognitionService } from '../../utils/speechRecognition';
import { useState, useEffect, useRef } from 'react';

interface ClientSideMicButtonProps {
  onTranscription: (text: string) => void;
  onError: (error: string) => void;
  className?: string;
}

const ClientSideMicButton = ({ onTranscription, onError, className = '' }: ClientSideMicButtonProps) => {
  const [isListening, setIsListening] = useState(false);
  const speechService = useRef<SpeechRecognitionService | null>(null);

  useEffect(() => {
    // Initialize speech recognition service
    speechService.current = new SpeechRecognitionService(
      (text: string) => {
        onTranscription(text);
        setIsListening(false);
      },
      (error: string) => {
        onError(error);
        setIsListening(false);
      }
    );

    return () => {
      if (speechService.current) {
        speechService.current.stopListening();
      }
    };
  }, [onTranscription, onError]);

  const handleMicClick = async () => {
    if (!speechService.current) return;

    if (isListening) {
      speechService.current.stopListening();
      setIsListening(false);
      return;
    }

    // Explicitly request microphone permission on Android/Chrome where
    // Web Speech API support is partial or permission prompts are flaky.
    try {
      if (navigator?.mediaDevices?.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      onError('Microphone permission was denied. Please enable mic permissions in your browser settings.');
      return;
    }

    try {
      await speechService.current.startListening();
      setIsListening(true);
    } catch (err) {
      onError('Failed to start listening. Your browser may not support speech recognition.');
      setIsListening(false);
    }
  };

  return (
    <button
      onClick={handleMicClick}
      className={`p-3 rounded-full transition-colors ${
        isListening 
          ? 'bg-red-500 hover:bg-red-600 text-white' 
          : 'bg-blue-500 hover:bg-blue-600 text-white'
      } ${className}`}
      title={isListening ? 'Stop listening' : 'Start listening'}
    >
      {isListening ? <FaMicrophoneSlash size={20} /> : <FaMicrophone size={20} />}
    </button>
  );
};

export default ClientSideMicButton;
