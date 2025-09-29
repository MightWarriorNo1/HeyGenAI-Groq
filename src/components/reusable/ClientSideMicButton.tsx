import { FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import { useState } from 'react';

interface ClientSideMicButtonProps {
  onTranscription: (text: string) => void;
  onError: (error: string) => void;
  className?: string;
  isVoiceChatActive: boolean;
  startVoiceChat: () => void;
  stopVoiceChat: () => void;
}

const ClientSideMicButton = ({ 
  onTranscription, 
  onError, 
  className = '', 
  isVoiceChatActive, 
  startVoiceChat, 
  stopVoiceChat 
}: ClientSideMicButtonProps) => {
  const [isListening, setIsListening] = useState(false);

  const handleMicClick = () => {
    if (isVoiceChatActive) {
      stopVoiceChat();
      setIsListening(false);
    } else {
      startVoiceChat();
      setIsListening(true);
    }
  };

  return (
    <button
      onClick={handleMicClick}
      className={`p-3 rounded-full transition-colors ${
        isListening || isVoiceChatActive
          ? 'bg-red-500 hover:bg-red-600 text-white' 
          : 'bg-blue-500 hover:bg-blue-600 text-white'
      } ${className}`}
      title={isListening || isVoiceChatActive ? 'Stop voice chat' : 'Start voice chat'}
    >
      {isListening || isVoiceChatActive ? <FaMicrophoneSlash size={20} /> : <FaMicrophone size={20} />}
    </button>
  );
};

export default ClientSideMicButton;
