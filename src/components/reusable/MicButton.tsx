import { FaMicrophone } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface MicButtonProps {
  isSpeaking: boolean;
  onClick: () => void;
  stopAvatar: () => void;
  grab: () => void;
  avatarStartLoading: boolean;
  avatarStopLoading: boolean;
  isVoiceChatActive: boolean;
  startVoiceChat: () => void;
  stopVoiceChat: () => void;
};

const MicButton = ({ 
  isSpeaking, 
  onClick, 
  stopAvatar, 
  grab, 
  avatarStartLoading, 
  avatarStopLoading, 
  isVoiceChatActive, 
  startVoiceChat, 
  stopVoiceChat 
}: MicButtonProps) => (
  <div className="  flex items-center justify-center w-[100%]  p-5">
    <div className="ml-4 text-gray-700 flex flex-col gap-2 items-center">
      <Button
        className={`flex items-center justify-center w-14 h-14 rounded-full text-white shadow-lg ${
          isSpeaking || isVoiceChatActive 
            ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700' 
            : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
        }`}
        onClick={isVoiceChatActive ? stopVoiceChat : startVoiceChat}
      >
        <FaMicrophone size={20} />
      </Button>
      {isVoiceChatActive ? 'Voice Chat Active' : isSpeaking ? 'Tap to Stop Speaking' : 'Tap to Start Voice Chat'}
      <div className='flex gap-2 items-center'>
        <Button onClick={stopAvatar} disabled={avatarStopLoading}>
          {
            avatarStopLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )
          }
          Stop Avatar
        </Button>
        <Button onClick={grab} disabled={avatarStartLoading}>
          {
            avatarStartLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )
          }
          Start Avatar
        </Button>
      </div>
    </div>
  </div>
);

export default MicButton;
