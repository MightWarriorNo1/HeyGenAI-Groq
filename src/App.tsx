import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from 'react';
import OpenAI from 'openai';
import { Configuration, NewSessionData, StreamingAvatarApi } from '@heygen/streaming-avatar';
import { getAccessToken } from './services/api';
import { Video } from './components/reusable/Video';
import ChatMessage from './components/reusable/ChatMessage';
import CameraModal from './components/reusable/CameraModal';
import ScrollableFeed from 'react-scrollable-feed';
import { Toaster } from "@/components/ui/toaster";
import { Loader2, Send } from 'lucide-react';
import { FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import { SpeechRecognitionService } from './utils/speechRecognition';

interface ChatMessageType  {
  role: string;
  message: string;
  media?: {
    file: File;
    type: 'photo' | 'video';
  };
};

function App() {
  //Toast
  const { toast } = useToast()

  const [isListening, setIsListening] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const [avatarSpeech, setAvatarSpeech] = useState<string>('');
  const [stream, setStream] = useState<MediaStream>();
  const [data, setData] = useState<NewSessionData>();
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);
  const speechService = useRef<SpeechRecognitionService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessageType[]>([
    // {
    //   role: 'user',
    //   message: 'hi, how are you!'
    // },
    // {
    //   role: 'assistant',
    //   message: 'I am fine, Thank you for asking. How about you!'
    // },
    // {
    //   role: 'user',
    //   message: 'Explain me about python!'
    // },
    // {
    //   role: 'assistant',
    //   message: "Python is an interpreted, object-oriented, high-level programming language with dynamic semantics. Its high-level built in data structures, combined with dynamic typing and dynamic binding, make it very attractive for Rapid Application Development, as well as for use as a scripting or glue language to connect existing components together. Python's simple, easy to learn syntax emphasizes readability and therefore reduces the cost of program maintenance. Python supports modules and packages, which encourages program modularity and code reuse. The Python interpreter and the extensive standard library are available in source or binary form without charge for all major platforms, and can be freely distributed."
    // },
    // {
    //   role: 'user',
    //   message: 'hi, how are you!'
    // },

  ]);

  const [startAvatarLoading, setStartAvatarLoading] = useState<boolean>(false);
  const [stopAvatarLoading, setStopAvatarLoading] = useState<boolean>(false);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  let timeout: any;


  const apiKey: any = import.meta.env.VITE_XAI_API_KEY;
  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: "https://api.x.ai/v1",
    dangerouslyAllowBrowser: true,
  });


  // Function to handle speech recognition
  const handleStartListening = async () => {
    if (speechService.current && !isListening && !isAiProcessing) {
      try {
        await speechService.current.startListening();
        setIsListening(true);
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        setIsListening(false);
      }
    }
  };

  const handleStopListening = () => {
    if (speechService.current) {
      speechService.current.stopListening();
      setIsListening(false);
    }
  };

  // Function to handle speech recognition results
  const handleSpeechResult = async (transcript: string) => {
    try {
      // Add user message to chat
      const updatedMessages = [...chatMessages, { role: 'user', message: transcript }];
      setChatMessages(updatedMessages);
      
      // Set loading state
      setIsAiProcessing(true);
      
      // Get AI response using xAI with full conversation context
      const aiResponse = await openai.chat.completions.create({
        model: 'grok-2-latest',
        messages: [
          { role: 'system', content: 'You are iSolveUrProblems, a helpful AI assistant. Respond naturally and maintain context from the entire conversation.' },
          ...updatedMessages.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.message }))
        ],
        temperature: 0.7,
        max_tokens: 2000
      });
      
      const aiMessage = aiResponse.choices[0].message.content || '';
      // Add AI response to chat
      setChatMessages(prev => [...prev, { role: 'assistant', message: aiMessage }]);
      // Set avatar speech to AI message so avatar can speak it
      setAvatarSpeech(aiMessage);
      
      // Clear loading state
      setIsAiProcessing(false);
    } catch (error: any) {
      console.error('Error processing speech result:', error);
      setIsAiProcessing(false);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      });
    }
  };

  // Function to handle speech recognition errors
  const handleSpeechError = (error: string) => {
    console.error('Speech recognition error:', error);
    toast({
      variant: "destructive",
      title: "Speech Recognition Error",
      description: error,
    });
    setIsListening(false);
  };

  // Function to handle file uploads
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newFiles = Array.from(files);
      
      // Process each file and add to chat immediately
      newFiles.forEach(file => {
        const fileType = file.type.startsWith('image/') ? 'photo' : 
                        file.type.startsWith('video/') ? 'video' : null;
        
        if (fileType) {
          // Add media message to chat immediately
          const mediaMessage: ChatMessageType = {
            role: 'user',
            message: `I uploaded a ${fileType}`,
            media: { file, type: fileType }
          };
          setChatMessages(prev => [...prev, mediaMessage]);
          
          // Process with AI
          processMediaWithAI(file, fileType);
        } else {
          // For non-media files, add to attached files as before
          setAttachedFiles(prev => [...prev, file]);
        }
      });
      
      // Clear the input
      event.target.value = '';
      
      toast({
        title: "Files processed",
        description: `${newFiles.length} file(s) processed successfully`,
      });
    }
  };

  // Function to handle camera capture from modal
  const handleCameraCapture = (file: File, type: 'photo' | 'video') => {
    // Add media to chat immediately
    const mediaMessage: ChatMessageType = {
      role: 'user',
      message: `I captured a ${type}`,
      media: { file, type }
    };
    
    setChatMessages(prev => [...prev, mediaMessage]);
    
    // Also add to attached files for context
    setAttachedFiles(prev => [...prev, file]);
    
    toast({
      title: `${type === 'photo' ? 'Photo' : 'Video'} captured`,
      description: `${type === 'photo' ? 'Photo' : 'Video'} has been added to the chat`,
    });
    
    // Close camera modal
    setIsCameraOpen(false);
    
    // Process with AI
    processMediaWithAI(file, type);
  };

  // Function to convert file to data URL
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Function to process media with AI
  const processMediaWithAI = async (file: File, type: 'photo' | 'video') => {
    try {
      // Set loading state
      setIsAiProcessing(true);
      
      let aiResponse;
      
      if (type === 'photo') {
        // For images, use vision model
        try {
          const imageDataUrl = await fileToDataUrl(file);
          
          // Build conversation history for vision
          const conversationHistory = chatMessages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.media ? `${msg.message} [${msg.media.type.toUpperCase()}: ${msg.media.file.name}]` : msg.message
          }));
          
          const messages = [
            ...conversationHistory,
            {
              role: 'user' as const,
              content: [
                { 
                  type: 'text' as const, 
                  text: `I've shared an image named "${file.name}". Please analyze what you can see and provide helpful insights about the content.` 
                },
                { 
                  type: 'image_url' as const, 
                  image_url: { url: imageDataUrl, detail: 'high' as const } 
                }
              ]
            }
          ];

          aiResponse = await openai.chat.completions.create({
            model: 'grok-2-vision',
            messages: messages,
            temperature: 0.7,
            max_tokens: 2000
          } as any);
          
        } catch (visionError) {
          console.warn('Vision analysis failed, falling back to text-only:', visionError);
          // Fallback to text-only analysis
          const conversationHistory = chatMessages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.media ? `${msg.message} [${msg.media.type.toUpperCase()}: ${msg.media.file.name}]` : msg.message
          }));
          
          aiResponse = await openai.chat.completions.create({
            model: 'grok-2-latest',
            messages: [
              ...conversationHistory,
              {
                role: 'user' as const,
                content: `I've shared an image file named "${file.name}" (${file.type}, ${Math.round(file.size / 1024)}KB). Since I cannot directly analyze the image content, could you please describe what's in the image or what you'd like help with? I'm here to assist with any questions or analysis you need.`
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          });
        }
      } else {
        // For videos, use text-only model (no vision support for videos yet)
        const conversationHistory = chatMessages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.media ? `${msg.message} [${msg.media.type.toUpperCase()}: ${msg.media.file.name}]` : msg.message
        }));
        
        aiResponse = await openai.chat.completions.create({
          model: 'grok-2-latest',
          messages: [
            ...conversationHistory,
            {
              role: 'user' as const,
              content: `I've shared a video file named "${file.name}" (${file.type}, ${Math.round(file.size / 1024)}KB). Could you please describe what's in the video or what you'd like help with? I'm here to assist with any questions or analysis you need.`
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        });
      }
      
      const aiMessage = aiResponse.choices[0].message.content || '';
      // Add AI response to chat
      setChatMessages(prev => [...prev, { role: 'assistant', message: aiMessage }]);
      // Set avatar speech to AI message so avatar can speak it
      setAvatarSpeech(aiMessage);
      
      // Clear loading state
      setIsAiProcessing(false);
    } catch (error: any) {
      console.error('Error processing media with AI:', error);
      setIsAiProcessing(false);
      toast({
        variant: "destructive",
        title: "Error processing media",
        description: error.message,
      });
    }
  };

  // Function to remove attached file
  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };


  // Function to handle text input with conversation context
  const handleTextSubmit = async (text: string) => {
    if (!text.trim() && attachedFiles.length === 0) return;

    try {
      // Add user message to chat
      const userMessage = text.trim() || `[Attached ${attachedFiles.length} file(s)]`;
      const updatedMessages = [...chatMessages, { role: 'user', message: userMessage }];
      setChatMessages(updatedMessages);
      
      // Clear input and attachments
      setInput('');
      setAttachedFiles([]);
      
      // Set loading state
      setIsAiProcessing(true);
      
      // Get AI response using xAI with full conversation context
      const aiResponse = await openai.chat.completions.create({
        model: 'grok-2-latest',
        messages: [
          { role: 'system', content: 'You are iSolveUrProblems, a helpful AI assistant. Respond naturally and maintain context from the entire conversation. If the user has attached files, acknowledge them and provide relevant assistance.' },
          ...updatedMessages.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.message }))
        ],
        temperature: 0.7,
        max_tokens: 2000
      });
      
      const aiMessage = aiResponse.choices[0].message.content || '';
      // Add AI response to chat
      setChatMessages(prev => [...prev, { role: 'assistant', message: aiMessage }]);
      // Set avatar speech to AI message so avatar can speak it
      setAvatarSpeech(aiMessage);
      
      // Clear loading state
      setIsAiProcessing(false);
    } catch (error: any) {
      console.error('Error processing text input:', error);
      setIsAiProcessing(false);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      });
    }
  };


  // Initialize speech recognition service
  useEffect(() => {
    speechService.current = new SpeechRecognitionService(
      handleSpeechResult,
      handleSpeechError
    );

    return () => {
      if (speechService.current) {
        speechService.current.stopListening();
      }
    };
  }, []);


  // useEffect getting triggered when the avatarSpeech state is updated, basically make the avatar to talk
  useEffect(() => {
    async function speak() {
      if (avatarSpeech && data?.sessionId) {
        try {
          await avatar.current?.speak({ taskRequest: { text: avatarSpeech, sessionId: data?.sessionId } });
        } catch (err: any) {
          console.error(err);
        }
      }
    }

    speak();
  }, [avatarSpeech, data?.sessionId]);


  // useEffect called when the component mounts, to fetch the accessToken and creates the new instance of StreamingAvatarApi
  useEffect(() => {
    async function fetchAccessToken() {
      try {
        const response = await getAccessToken();
        const token = response.data.data.token;


        if (!avatar.current) {
          avatar.current = new StreamingAvatarApi(
            new Configuration({ accessToken: token })
          );
        }
        console.log(avatar.current)
        // Clear any existing event handlers to prevent duplication
        avatar.current.removeEventHandler("avatar_stop_talking", handleAvatarStopTalking);
        avatar.current.addEventHandler("avatar_stop_talking", handleAvatarStopTalking);

      } catch (error: any) {
        console.error("Error fetching access token:", error);
        toast({
          variant: "destructive",
          title: "Uh oh! Something went wrong.",
          description: error.response.data.message || error.message,
        })
      }
    }

    fetchAccessToken();

    return () => {
      // Cleanup event handler and timeout
      if (avatar.current) {
        avatar.current.removeEventHandler("avatar_stop_talking", handleAvatarStopTalking);
      }
      clearTimeout(timeout);
    }

  }, []);

// Avatar stop talking event handler
const handleAvatarStopTalking = (e: any) => {
  console.log("Avatar stopped talking", e);
  // Only auto-start listening if user is not already listening and not processing AI
  if (!isListening && !isAiProcessing) {
    timeout = setTimeout(async () => {
      try {
        // Check if microphone is available before starting
        await navigator.mediaDevices.getUserMedia({ audio: true });
        handleStartListening();
      } catch (error: any) {
        console.log("Microphone not available, skipping auto-start listening:", error.message);
        // Don't show error toast for auto-start failures, just log it
      }
    }, 2000);
  }
};


// Function to initiate the avatar
async function grab() {
  setStartAvatarLoading(true);
  
  // Check if required environment variables are present
  const avatarId = import.meta.env.VITE_HEYGEN_AVATARID;
  const voiceId = import.meta.env.VITE_HEYGEN_VOICEID;
  
  if (!avatarId || !voiceId) {
    setStartAvatarLoading(false);
    toast({
      variant: "destructive",
      title: "Missing Configuration",
      description: 'Missing HeyGen environment variables. Please check VITE_HEYGEN_AVATARID and VITE_HEYGEN_VOICEID in your .env file.',
    });
    return;
  }
  
  try {

    const response = await getAccessToken();
    const token = response.data.data.token;

    if (!avatar.current) {
      avatar.current = new StreamingAvatarApi(
        new Configuration({ accessToken: token })
      );
    }

    const res = await avatar.current!.createStartAvatar(
      {
        newSessionRequest: {
          quality: "high",
          avatarName: avatarId,
          voice: { voiceId: voiceId }
        }
      },
    );
    console.log(res);
    setData(res);
    setStream(avatar.current!.mediaStream);
    setStartAvatarLoading(false);

  } catch (error: any) {
    console.error('Error starting avatar:', error);
    console.error('Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      avatarId: avatarId,
      voiceId: voiceId
    });
    setStartAvatarLoading(false);
    
    let errorMessage = 'Failed to start avatar. Please check your HeyGen configuration.';
    if (error.response?.status === 400) {
      errorMessage = 'Invalid avatar or voice configuration. Please check your HeyGen avatar and voice IDs.';
    } else if (error.response?.status === 401) {
      errorMessage = 'Invalid HeyGen API key. Please check your authentication.';
    } else if (error.response?.status === 404) {
      errorMessage = 'Avatar or voice not found. Please check your HeyGen configuration.';
    }
    
    toast({
      variant: "destructive",
      title: "Error starting avatar",
      description: errorMessage,
    })
  }
};


//Function to stop the avatar
async function stop() {
  setStopAvatarLoading(true);
  try {
    await avatar.current?.stopAvatar({ stopSessionRequest: { sessionId: data?.sessionId } });
    // handleStopSpeaking();
    setStopAvatarLoading(false);
    avatar.current = null;
  } catch (error: any) {
    setStopAvatarLoading(false);
    toast({
      variant: "destructive",
      title: "Uh oh! Something went wrong.",
      description: error.response.data.message || error.message,
    })
  }
}




// When the stream gets the data, The avatar video will gets played
useEffect(() => {
  if (stream && mediaStream.current) {
    console.log(stream);
    console.log(mediaStream.current);
    mediaStream.current.srcObject = stream;
    mediaStream.current.muted = false;
    mediaStream.current.volume = 1.0;
    mediaStream.current.onloadedmetadata = () => {
      mediaStream.current!.play();
    };
  }
}, [stream]);

return (
  <>
    <Toaster />
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-purple-800">
      {/* Header - Fixed at top, mobile responsive */}
      <div className="fixed top-0 left-0 right-0 w-full bg-white/10 backdrop-blur-sm border-b border-white/20 z-30">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-white text-center">iSolveUrProblems – beta</h1>
        </div>
      </div>

      {/* Main Content Area - Responsive layout for mobile and desktop */}
      <div className="flex flex-col lg:flex-row w-full h-screen pt-16 sm:pt-20">
        {/* Video Container - Full screen on mobile, side panel on desktop */}
        <div className="relative w-full lg:w-1/2 h-1/2 lg:h-full">
          <Video ref={mediaStream} />
        </div>
        
        {/* Chat Container - Overlay on mobile, side panel on desktop */}
        <div className="lg:w-1/2 h-1/2 lg:h-full bg-white/95 backdrop-blur-md border-l border-white/20">
          {/* Chat Header - Fixed */}
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-3 flex items-center justify-between border-b border-white/20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-sm font-semibold text-white">Chat Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1 h-1 bg-white/60 rounded-full"></div>
              <div className="w-1 h-1 bg-white/60 rounded-full"></div>
              <div className="w-1 h-1 bg-white/60 rounded-full"></div>
            </div>
          </div>
          
          {/* Chat Content - Scrollable */}
          <div className="h-full overflow-hidden">
            {
              chatMessages.length > 0 ? (
                <ScrollableFeed className="w-full h-full">
                  <div className="p-4 overflow-y-auto w-full h-full bg-gray-50/30">
                    {
                        chatMessages.map((chatMsg, index) => (
                      <ChatMessage
                        key={index}
                        role={chatMsg.role}
                        message={chatMsg.message}
                            media={chatMsg.media}
                      />
                        ))
                    }
                    {isAiProcessing && (
                      <div className="flex justify-start mb-2">
                        <div className="flex items-center gap-2 p-3 rounded-2xl bg-blue-100 text-blue-700">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">AI is thinking...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollableFeed>
              ) : (
                <div className="p-6 overflow-y-auto flex flex-col justify-center items-center w-full h-full bg-gray-50/30">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">Welcome to iSolveUrProblems</h3>
                  <p className="text-gray-500 text-center max-w-sm">Start a conversation with your AI assistant. Ask questions, get help, or just chat!</p>
                </div>
              )
            }
          </div>
        </div>
      </div>

      {/* Avatar Control Buttons - Positioned above input bar */}
      <div className="fixed bottom-20 sm:bottom-24 left-1/2 transform -translate-x-1/2 z-30 lg:left-1/2 lg:transform-none lg:bottom-20">
        <div className="flex gap-2 sm:gap-3">
          <button
            onClick={grab}
            disabled={startAvatarLoading}
            className="px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 text-xs sm:text-sm lg:text-base shadow-lg hover:shadow-xl disabled:shadow-none backdrop-blur-sm border border-white/20"
          >
            {startAvatarLoading ? (
              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
            ) : (
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="hidden sm:inline">Start Avatar</span>
            <span className="sm:hidden">Start</span>
          </button>
          <button
            onClick={stop}
            disabled={stopAvatarLoading}
            className="px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 text-xs sm:text-sm lg:text-base shadow-lg hover:shadow-xl disabled:shadow-none backdrop-blur-sm border border-white/20"
          >
            {stopAvatarLoading ? (
              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
            ) : (
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
              </svg>
            )}
            <span className="hidden sm:inline">Stop Avatar</span>
            <span className="sm:hidden">Stop</span>
          </button>
        </div>
      </div>

      {/* Attached Files Display - Responsive positioning */}
      {attachedFiles.length > 0 && (
        <div className="fixed bottom-16 sm:bottom-20 left-0 right-0 lg:left-1/2 lg:right-0 bg-white/95 backdrop-blur-md border-t border-white/30 p-3 sm:p-4 z-20 shadow-lg">
          <div className="container mx-auto lg:mx-0 max-w-2xl lg:max-w-none">
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {attachedFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl px-3 py-2 shadow-sm">
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-xs sm:text-sm text-gray-700 truncate max-w-24 sm:max-w-32 font-medium">{file.name}</span>
                  <button
                    onClick={() => removeAttachedFile(index)}
                    className="text-red-500 hover:text-red-700 text-sm font-bold p-1 hover:bg-red-50 rounded-full transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chat Bar - Responsive positioning */}
      <div className='fixed bottom-0 left-0 right-0 lg:left-1/2 lg:right-0 bg-white/95 backdrop-blur-md border-t border-white/30 p-3 sm:p-4 z-20 shadow-2xl'>
        <div className="container mx-auto lg:mx-0 max-w-2xl lg:max-w-none">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Paper Clip Button */}
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isAiProcessing}
              className="p-2.5 sm:p-3 bg-gradient-to-br from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-sm hover:shadow-md"
              title={isAiProcessing ? 'AI is processing...' : 'Upload images or videos'}
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Camera Button */}
            <button 
              onClick={() => setIsCameraOpen(true)}
              disabled={isAiProcessing}
              className="p-2.5 sm:p-3 bg-gradient-to-br from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-sm hover:shadow-md"
              title={isAiProcessing ? 'AI is processing...' : 'Open camera'}
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* Input Bar */}
            <div className="flex-1 relative min-w-0">
              <input
                type="text"
                placeholder={isAiProcessing ? "AI is thinking..." : "Type your message..."}
                className="w-full px-4 sm:px-5 py-3 sm:py-4 pr-12 sm:pr-14 bg-white/90 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base shadow-sm hover:shadow-md transition-all duration-200"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !isAiProcessing) {
                    handleTextSubmit(input);
                  }
                }}
                disabled={isAiProcessing}
              />
              {/* Send Button */}
              <button
                onClick={() => handleTextSubmit(input)}
                disabled={isAiProcessing || !input.trim()}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-xl transition-all duration-200 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Mic Button */}
            <button
              onClick={isListening ? handleStopListening : handleStartListening}
              disabled={isAiProcessing}
              className={`p-2.5 sm:p-3 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-sm hover:shadow-md ${
                isListening 
                  ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white' 
                  : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white'
              }`}
              title={isAiProcessing ? 'AI is processing...' : (isListening ? 'Stop listening' : 'Start listening')}
            >
              {isListening ? <FaMicrophoneSlash size={16} className="sm:w-5 sm:h-5" /> : <FaMicrophone size={16} className="sm:w-5 sm:h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Camera Modal */}
      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleCameraCapture}
      />
    </div>
  </>
);
}

export default App;
