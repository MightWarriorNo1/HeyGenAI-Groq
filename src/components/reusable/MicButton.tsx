import { FaMicrophone } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
// import { Loader2 } from 'lucide-react';

interface MicButtonProps {
  isSpeaking: boolean;
  onClick: () => void;
  stopAvatar: () => void;
  grab: () => void;
  avatarStartLoading: boolean;
  avatarStopLoading: boolean;
};

const MicButton = ({ isSpeaking, onClick,
  //  stopAvatar, 
  //  grab, 
  //  avatarStartLoading, 
  //  avatarStopLoading 
  }: MicButtonProps) => (
  <div className="flex items-center justify-center w-full p-3 sm:p-5">
    <div className="text-gray-700 flex flex-col gap-2 items-center">
      <Button
        className={`flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full hover:bg-blue-500 text-white shadow-lg ${isSpeaking ? 'bg-gray-800 hover:bg-gray-800' : 'bg-blue-500'}`}
        onClick={onClick}
      >
        <FaMicrophone size={16} className="sm:w-5 sm:h-5" />
      </Button>
      <span className="text-xs sm:text-sm text-center text-white">{isSpeaking ? '🎤 Capturing your thoughts...' : 'Ready for some intellectual sparring?'}</span>
      {/* <div className='flex flex-col sm:flex-row gap-2 items-center'>
        <Button 
          onClick={stopAvatar} 
          disabled={avatarStopLoading}
          className="text-xs sm:text-sm px-3 py-1 sm:px-4 sm:py-2"
        >
          {
            avatarStopLoading && (
              <Loader2 className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
            )
          }
          Stop Avatar
        </Button>
        <Button 
          onClick={grab} 
          disabled={avatarStartLoading}
          className="text-xs sm:text-sm px-3 py-1 sm:px-4 sm:py-2"
        >
          {
            avatarStartLoading && (
              <Loader2 className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
            )
          }
          Start Avatar
        </Button>
      </div> */}
    </div>
  </div>
);

export default MicButton;
