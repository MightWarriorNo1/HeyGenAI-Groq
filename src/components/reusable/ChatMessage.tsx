// src/components/ChatMessage.tsx
import { useEffect, useRef } from 'react';
import MediaMessage from './MediaMessage';
import IPadAvatar from './IPadAvatar';

interface ChatMessageProps {
    role: string;
    message: string;
    media?: {
        file: File;
        type: 'photo' | 'video';
    };
};

const ChatMessage=({ role, message, media }: ChatMessageProps) => {

    const messageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if(messageRef.current) {
            messageRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [message])
    
    return (
        <div ref={messageRef}>
            {/* Media Message */}
            {media && (
                <MediaMessage 
                    file={media.file} 
                    type={media.type} 
                    role={role as 'user' | 'assistant'} 
                />
            )}
            
            {/* Text Message */}
            {message && (
                <div
                    className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}
                >
                    {
                        role ==='assistant' && (
                        <IPadAvatar 
                            src="https://github.com/shadcn.png" 
                            alt="Assistant Avatar"
                            fallback="AI"
                            className="mr-1 sm:mr-2 w-6 h-6 sm:w-8 sm:h-8"
                            onLoad={() => console.log('Assistant avatar loaded')}
                            onError={(e) => console.log('Assistant avatar failed to load', e)}
                        />
                        )
                    }
                    <div
                        className={`p-3 sm:p-4 rounded-2xl sm:rounded-3xl text-white ${role === 'user' ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 'bg-gradient-to-r from-gray-500 to-gray-600'} max-w-[85%] sm:max-w-[70%] lg:max-w-[50%] text-sm sm:text-base break-words shadow-sm`}
                    >
                        {message}
                    </div>
                    {
                        role ==='user' && (
                        <IPadAvatar 
                            src="https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg" 
                            alt="User Avatar"
                            fallback="U"
                            className="ml-1 sm:ml-2 w-6 h-6 sm:w-8 sm:h-8"
                            onLoad={() => console.log('User avatar loaded')}
                            onError={(e) => console.log('User avatar failed to load', e)}
                        />
                        )
                    }
                </div>
            )}
        </div>
    );
}
   

export default ChatMessage;
