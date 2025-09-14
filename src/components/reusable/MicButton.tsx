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
};

const MicButton = ({ isSpeaking, onClick, stopAvatar, grab, avatarStartLoading, avatarStopLoading }: MicButtonProps) => (
  <div className="  flex items-center justify-center w-[100%]  p-5">
    <div className="ml-4 text-gray-700 flex flex-col gap-2 items-center">
      <Button
        className={`flex items-center justify-center w-14 h-14 rounded-full hover:bg-blue-500 text-white shadow-lg ${isSpeaking ? 'bg-gray-800 hover:bg-gray-800' : 'bg-blue-500'}`}
        onClick={onClick}
      >
        <FaMicrophone size={20} />
      </Button>
      {isSpeaking ? 'Tap to Stop Speaking' : 'Tap to Speak'}
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
