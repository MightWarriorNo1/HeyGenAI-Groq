/*eslint-disable*/
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import OpenAI from 'openai';
import { Configuration, NewSessionData, StreamingAvatarApi } from '@heygen/streaming-avatar';
import { getAccessToken } from './services/api';
import { Video } from './components/reusable/Video';
import { Toaster } from "@/components/ui/toaster";
import { createApiCall, handleApiError } from './utils/api-helpers';
import { Button } from "@/components/ui/button";
import { Camera, Paperclip } from "lucide-react";

// Lazy load heavy components for faster initial load
const Badges = lazy(() => import('./components/reusable/Badges').then(module => ({ default: module.Badges })));
const BrandHeader = lazy(() => import('./components/reusable/BrandHeader'));
const MicButton = lazy(() => import('./components/reusable/MicButton'));
const CameraVideo = lazy(() => import('./components/reusable/CameraVideo').then(module => ({ default: module.CameraVideo })));


function App() {
  //Toast
  const { toast } = useToast()

  const [startLoading, setStartLoading] = useState<boolean>(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string, content: string}>>([]);
  const [dynamicButtons, setDynamicButtons] = useState<string[]>([]);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [stream, setStream] = useState<MediaStream>();
  const [data, setData] = useState<NewSessionData>();
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);

  const [startAvatarLoading, setStartAvatarLoading] = useState<boolean>(false);
  const [stopAvatarLoading, setStopAvatarLoading] = useState<boolean>(false);
  const [isSessionStarted, setIsSessionStarted] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  
  // Camera states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  
  // Pre-warm avatar for faster response
  const preWarmAvatar = useRef<boolean>(false);
  const smallAvatarRef = useRef<HTMLVideoElement>(null);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const analysisQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  
  // Response cache for faster repeated queries
  const responseCache = useRef<Map<string, string>>(new Map());
  
  // Media analysis state
  const [currentMediaAnalysis, setCurrentMediaAnalysis] = useState<string>('');
  const [hasMediaContext, setHasMediaContext] = useState<boolean>(false);
  const [mediaFileName, setMediaFileName] = useState<string>('');
  
  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  
  // Persistent media context using refs to survive re-renders
  const mediaContextRef = useRef<{
    analysis: string;
    fileName: string;
    hasContext: boolean;
  }>({
    analysis: '',
    fileName: '',
    hasContext: false
  });
  
  // Audio context and gain node for volume control
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const [volumeLevel] = useState<number>(2.0); // Default to 2x volume boost
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  
  let timeout: any;

  // Function to set up audio context with gain control for volume boost
  const setupAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext)();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = volumeLevel;
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }
  };


  // Pre-warm avatar for faster response
  const preWarmAvatarForResponse = async () => {
    if (avatar.current && data?.sessionId && !preWarmAvatar.current) {
      try {
        // Send a minimal test message to warm up the avatar
        await avatar.current.speak({ 
          taskRequest: { 
            text: "Ready", 
            sessionId: data.sessionId 
          } 
        });
        preWarmAvatar.current = true;
        console.log('🔥 Avatar pre-warmed for faster responses');
      } catch (error) {
        console.log('Pre-warm failed, will use normal flow:', error);
      }
    }
  };

  // Function to process analysis queue with reduced latency
  const processAnalysisQueue = async () => {
    if (isProcessingQueueRef.current || analysisQueueRef.current.length === 0) return;
    
    isProcessingQueueRef.current = true;
    const analysis = analysisQueueRef.current.shift();
    
    if (analysis && avatar.current && data?.sessionId) {
      try {
        setIsAvatarSpeaking(true);
        
        // Start speaking immediately without waiting
        const speakPromise = avatar.current.speak({ 
          taskRequest: { 
            text: analysis, 
            sessionId: data.sessionId 
          } 
        });
        
        // Process next item in queue immediately after starting speech
        speakPromise.then(() => {
          // Reduced delay - only wait for speech to complete
          setTimeout(() => {
            setIsAvatarSpeaking(false);
            isProcessingQueueRef.current = false;
            // Process next item immediately if available
            if (analysisQueueRef.current.length > 0) {
              processAnalysisQueue();
            }
          }, 1000); // Reduced from 2000ms to 500ms
        }).catch((speakError) => {
          console.error('Error making avatar speak:', speakError);
          setIsAvatarSpeaking(false);
          isProcessingQueueRef.current = false;
        });
        
      } catch (speakError) {
        console.error('Error making avatar speak:', speakError);
        setIsAvatarSpeaking(false);
        isProcessingQueueRef.current = false;
      }
    } else {
      isProcessingQueueRef.current = false;
    }
  };


  // Function to generate dynamic buttons based on conversation context
  const generateDynamicButtons = async (conversation: Array<{role: string, content: string}>) => {
    try {
      const response = await createApiCall(
        () => openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `Generate 4 witty button prompts (1-4 words each) based on conversation. Return only the 4 button texts, one per line.`
            },
            {
              role: 'user',
              content: `Context: ${conversation.slice(-2).map(msg => msg.content).join(' ')}` // Only use last 2 messages for faster processing
            }
          ],
          max_tokens: 100, // Reduced for faster response
          temperature: 0.7
        }),
      );
      
      const buttons = response.choices[0].message.content?.split('\n').filter(btn => btn.trim()) || [];
      setDynamicButtons(buttons);
    } catch (error) {
      console.error('Error generating dynamic buttons:', error);
      // Fallback to default buttons
      setDynamicButtons([
        "Mind-Bending Mysteries",
        "Money Magic & Mayhem", 
        "Love & Laughter Therapy",
        "Life's Comedy Coach"
      ]);
    }
  };

  const apiKey: any = import.meta.env.VITE_OPENAI_API_KEY;
  const openai = new OpenAI({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
    // Optimized configuration for better performance
    timeout: 30000, // 30 second timeout for complex requests
    maxRetries: 3, // More retries for reliability
    // Add request timeout configuration
    defaultHeaders: {
      'User-Agent': 'AI-Assistant-App/1.0'
    }
  });


  // Function to start continuous listening for voice input
  const startContinuousListening = () => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        const audioContext = new (window.AudioContext)(); 
        const mediaStreamSource = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
      
        mediaStreamSource.connect(analyser);

        let isRecording = false;
        let silenceStart: number | null = null;
        const silenceTimeout = 1000; // 2 seconds of silence
        const voiceThreshold = 30; // Voice detection threshold

        const checkForVoice = () => {
          analyser.getByteFrequencyData(dataArray);
          const avgVolume = dataArray.reduce((a, b) => a + b) / bufferLength;

          if (avgVolume > voiceThreshold && !isRecording) {
            // Voice detected, start recording
            console.log('🎤 Someone is trying to talk to me! Let me listen...');
            isRecording = true;
            silenceStart = null;
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = [];

            mediaRecorder.current.ondataavailable = (event) => {
              audioChunks.current.push(event.data);
            };

            mediaRecorder.current.onstop = () => {
              const audioBlob = new Blob(audioChunks.current, {
                type: 'audio/wav',
              });
              audioChunks.current = [];
              transcribeAudio(audioBlob);
              isRecording = false;
            };

            mediaRecorder.current.start();
            setIsSpeaking(true);
          } else if (avgVolume < voiceThreshold && isRecording) {
            // Voice stopped, check for silence
            if (!silenceStart) silenceStart = Date.now();

            if (Date.now() - silenceStart >= silenceTimeout) {
              console.log('🤫 Ah, the silence! Let me process what you said...');
              if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
                mediaRecorder.current.stop();
              }
              setIsSpeaking(false);
              isRecording = false;
              silenceStart = null;
            }
          } else if (avgVolume > voiceThreshold && isRecording) {
            // Still speaking, reset silence timer
            silenceStart = null;
          }

          // Continue monitoring
          requestAnimationFrame(checkForVoice);
        };

        checkForVoice();
      })
      .catch((error) => {
        console.error('Error accessing microphone:', error);
        toast({
          variant: "destructive",
          title: "Uh oh! Something went wrong.",
          description: error.message,
        })
      });
  };

  //Function when user starts speaking (kept for mic button compatibility)
  const handleStartSpeaking = () => {
    startContinuousListening();
  };

  const handleStopSpeaking = async () => {
    if (mediaRecorder.current) {
      mediaRecorder.current.stop();
      mediaRecorder.current = null;
      setIsSpeaking(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  // Function to clear media context
  const clearMediaContext = () => {
    setCurrentMediaAnalysis('');
    setHasMediaContext(false);
    setMediaFileName('');
    mediaContextRef.current = {
      analysis: '',
      fileName: '',
      hasContext: false
    };
    toast({
      title: "📎 Context cleared",
      description: "I'm ready for a new file or conversation!",
    });
  };

  // Function to handle file upload
  const handleFileUpload = async (file: File) => {
    try {
      // Check file size limits to prevent timeout issues
      // const maxFileSize = 5 * 1024 * 1024;
      // if (file.size > maxFileSize) {
      //   toast({
      //     variant: "destructive",
      //     title: "File too large",
      //     description: `Please upload files smaller than 5MB. Current file: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
      //   });
      //   return;
      // }

      // Show natural, conversational loading messages
      const fileTypeMessages = {
        'image': "👀 Taking a look at your image...",
        'video': "🎬 Analyzing your video...", 
        'text': "📖 Reading through your document...",
        'default': "🔍 Examining your file..."
      };
      
      const fileType = file.type.startsWith('image/') ? 'image' : 
                      file.type.startsWith('video/') ? 'video' : 
                      file.type.startsWith('text/') ? 'text' : 'default';
      
      toast({
        title: fileTypeMessages[fileType],
        description: `Just a moment while I process ${file.name}...`,
      });

      let aiResponse;

      if (file.type.startsWith('image/')) {
        // Optimize image processing to reduce payload size
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        const base64 = await new Promise<string>((resolve) => {
          img.onload = () => {
            // Resize image to max 1024x1024 to reduce payload size
            const maxSize = 1024;
            let { width, height } = img;
            
            if (width > height) {
              if (width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
              }
            } else {
              if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
              }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx?.drawImage(img, 0, 0, width, height);
            
            // Convert to base64 with compression
            const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            resolve(base64Data);
          };
          img.src = URL.createObjectURL(file);
        });

        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Please analyze this image and provide a detailed description. What do you see in this image? Please be specific about objects, people, text, colors, and any other notable details.`
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${base64}`
                    }
                  }
                ]
              }
            ],
            max_tokens: 1000
          }),
          { timeout: 60000, retries: 2 }
        );

      } else if (file.type.startsWith('video/')) {
        // Handle videos - extract frame for analysis with optimization
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const videoUrl = URL.createObjectURL(file);
        video.src = videoUrl;
        
        // Wait for video to load and extract a frame
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Video loading timeout'));
          }, 10000); // 10 second timeout for video processing
          
          video.onloadedmetadata = () => {
            video.currentTime = 1; // Get frame at 1 second
          };
          video.onseeked = () => {
            // Resize frame to reduce payload size
            const maxSize = 1024;
            let { videoWidth, videoHeight } = video;
            
            if (videoWidth > videoHeight) {
              if (videoWidth > maxSize) {
                videoHeight = (videoHeight * maxSize) / videoWidth;
                videoWidth = maxSize;
              }
            } else {
              if (videoHeight > maxSize) {
                videoWidth = (videoWidth * maxSize) / videoHeight;
                videoHeight = maxSize;
              }
            }
            
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            ctx?.drawImage(video, 0, 0, videoWidth, videoHeight);
            clearTimeout(timeout);
            resolve(null);
          };
          video.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Video loading failed'));
          };
        });

        // Convert canvas to base64 with compression
        const frameBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        
        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Please analyze this video frame from "${file.name}". Describe what you see in this frame, including any objects, people, text, activities, or notable details. This is a frame from a video file.`
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${frameBase64}`
                    }
                  }
                ]
              }
            ],
            max_tokens: 1000
          }),
          { timeout: 60000, retries: 2 }
        );

        URL.revokeObjectURL(videoUrl);

      } else if (file.type.startsWith('text/')) {
        // Handle text files with size limits
        const fileContent = await file.text();
        const maxTextLength = 50000; // 50KB text limit
        
        if (fileContent.length > maxTextLength) {
          toast({
            variant: "destructive",
            title: "📄 File too large",
            description: `That document is quite long! Please keep it under 50KB (currently ${(fileContent.length / 1024).toFixed(1)}KB)`,
          });
          return;
        }
        
        const prompt = `I've uploaded a text file: ${file.name}. Here's the content:\n\n${fileContent}\n\nPlease analyze this content and provide insights or help with it.`;
        
        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              { role: 'user', content: prompt }
            ],
            max_tokens: 2000
          }),
          { timeout: 30000, retries: 2 }
        );

      } else {
        // For other file types, provide basic analysis
        const prompt = `I've uploaded a file: ${file.name} (${file.type}). Please help me understand what I can do with this file and provide any relevant guidance.`;
        
        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              { role: 'user', content: prompt }
            ],
            max_tokens: 1000
          }),
          { timeout: 30000, retries: 2 }
        );
      }
      
      const analysisResult = aiResponse.choices[0].message.content || '';
      
      // Store the media analysis for future context
      console.log('💾 Storing media analysis:', { analysisResult, fileName: file.name });
      setCurrentMediaAnalysis(analysisResult);
      setHasMediaContext(true);
      setMediaFileName(file.name);
      
      // Also store in ref for persistence
      mediaContextRef.current = {
        analysis: analysisResult,
        fileName: file.name,
        hasContext: true
      };
      
      // Verify state was set
      setTimeout(() => {
        console.log('🔍 State after setting:', { hasMediaContext, currentMediaAnalysis, mediaFileName });
        console.log('🔍 Ref after setting:', mediaContextRef.current);
      }, 100);
      
      // Natural, conversational success messages
      const successMessages = {
        'image': "🖼️ Great! I can see your image clearly. What would you like to know about it?",
        'video': "🎬 Perfect! I've analyzed your video. What caught your attention in it?",
        'text': "📖 I've read through your document. What would you like to discuss about it?",
        'default': "📎 I've examined your file. How can I help you with it?"
      };
      
      toast({
        title: successMessages[fileType],
        description: `Ready to chat about ${file.name}!`,
      });
      
      // Make avatar ask what help the user needs in a natural way
      const helpPrompt = `I've analyzed your ${file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'} "${file.name}". What would you like me to help you with regarding this ${file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'}? I can provide insights, answer questions, or help you with anything related to what I found in it.`;
      
      setInput(helpPrompt);
      
    } catch (error: any) {
      console.error('Error processing file:', error);
      const errorInfo = handleApiError(error);
      toast({
        variant: "destructive",
        title: "Hmm, that didn't work",
        description: "I couldn't process that file. Mind trying a different one?",
      });
    }
  };

  // Function to transcribe the audio to text and then get the respective response of the given prompt
  async function transcribeAudio(audioBlob: Blob) {
    try {
      // Convert Blob to File
      const audioFile = new File([audioBlob], 'recording.wav', {
        type: 'audio/wav',
      });

      // Start transcription for faster processing with timeout
      const transcriptionResponse = await createApiCall(
        () => openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: audioFile,
          response_format: 'text'
        }),
      );

      // Handle transcription response - with response_format: 'text', it returns a string directly
      let transcription: string;
      
      if (typeof transcriptionResponse === 'string') {
        // Direct string response when using response_format: 'text'
        transcription = transcriptionResponse;
      } else if (transcriptionResponse && typeof transcriptionResponse === 'object' && 'text' in transcriptionResponse) {
        // Object response when using other formats
        transcription = transcriptionResponse.text;
      } else {
        console.error('Invalid transcription response structure:', transcriptionResponse);
        toast({
          variant: "destructive",
          title: "Transcription Error",
          description: "Invalid response from transcription service. Please try again.",
        });
        return;
      }
      
      // Check if transcription is valid
      if (!transcription || typeof transcription !== 'string') {
        console.error('Invalid transcription response:', transcriptionResponse);
        toast({
          variant: "destructive",
          title: "Transcription Error",
          description: "Failed to transcribe audio. Please try again.",
        });
        return;
      }

      // Check if user is asking about vision/camera analysis
      const visionKeywords = [
        'what do you see', 'what can you see', 'describe what you see', 'analyze', 'look at',
        'camera', 'vision', 'see', 'watching', 'observe', 'describe', 'tell me about',
        'what is that', 'what are you looking at', 'can you see', 'do you see'
      ];
      
      const transcriptionLower = transcription.toLowerCase();
      const isVisionRequest = visionKeywords.some(keyword => 
        transcriptionLower.includes(keyword)
      );

      // If user is asking about vision and camera is active, trigger analysis
      if (isVisionRequest && isCameraActive && cameraVideoRef.current) {
        console.log('👁️ User is asking about vision! Let me analyze what I see...');
        handleVisionAnalysis(transcription);
        return; // Don't process as regular conversation
      }
      
      // Check cache first for faster response (but skip cache if media context is active)
      const cacheKey = transcription.toLowerCase().trim();
      const cachedResponse = responseCache.current.get(cacheKey);
      
      if (cachedResponse && !hasMediaContext) {
        console.log('🚀 Using cached response for faster reply!');
        setInput(cachedResponse);
        
        // Update conversation history
        const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
        setConversationHistory(updatedHistory);
        
        const finalHistory = [...updatedHistory, { role: 'assistant', content: cachedResponse }];
        setConversationHistory(finalHistory);
        
        // Generate dynamic buttons in background
        generateDynamicButtons(finalHistory).catch(error => {
          console.warn('Dynamic buttons generation failed:', error);
        });
        return;
      }
      
      // Build messages array with conversation history and media context
      const messages: any[] = [];
      
      // Always add system prompt first
      messages.push({
        role: 'system',
        content: 'You are a clever, witty AI assistant. Keep responses under 100 words, be engaging and conversational.'
      });
      
      // Add media analysis if available (check both state and ref)
      const effectiveMediaContext = hasMediaContext || mediaContextRef.current.hasContext;
      const effectiveAnalysis = currentMediaAnalysis || mediaContextRef.current.analysis;
      const effectiveFileName = mediaFileName || mediaContextRef.current.fileName;
      
      if (effectiveMediaContext && effectiveAnalysis && effectiveFileName) {
        console.log('🎯 Media context is active!', { 
          hasMediaContext, 
          mediaFileName, 
          currentMediaAnalysis,
          refContext: mediaContextRef.current
        });
        
        // Create a more natural, conversational context message
        const fileType = effectiveFileName.split('.').pop()?.toLowerCase();
        const mediaType = fileType && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileType) ? 'image' :
                         fileType && ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(fileType) ? 'video' :
                         fileType && ['txt', 'pdf', 'doc', 'docx'].includes(fileType) ? 'document' : 'file';
        
        messages.push({
          role: 'assistant',
          content: `I've been looking at your ${mediaType} "${effectiveFileName}". Here's what I noticed: ${effectiveAnalysis}\n\nFeel free to ask me anything about it - I'm here to help you understand or work with this ${mediaType}!`
        });
      } else {
        console.log('❌ No media context', { 
          hasMediaContext, 
          mediaFileName, 
          currentMediaAnalysis,
          refContext: mediaContextRef.current
        });
      }
      
      // Add conversation history
      messages.push(...conversationHistory);
      
      // Add current user message
      messages.push({ role: 'user', content: transcription || '' });
      
      console.log('📤 Sending messages to OpenAI:', messages);
      
      // Update conversation history
      const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
      setConversationHistory(updatedHistory);
      
      const specificResponse = await createApiCall(
        () => openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: messages,
          max_tokens: 150, // Reduced for faster response
          temperature: 0.8
        }),
      );
      
      const aiMessage = (specificResponse as any).choices[0].message.content || '';
      
      // Cache the response for future use
      responseCache.current.set(cacheKey, aiMessage);
      
      // Limit cache size to prevent memory issues
      if (responseCache.current.size > 50) {
        const firstKey = responseCache.current.keys().next().value;
        if (firstKey) {
          responseCache.current.delete(firstKey);
        }
      }
      
      setInput(aiMessage);
      
      // Update conversation history with AI response
      const finalHistory = [...updatedHistory, { role: 'assistant', content: aiMessage }];
      setConversationHistory(finalHistory);
      
      // Generate dynamic buttons in background (non-blocking)
      generateDynamicButtons(finalHistory).catch(error => {
        console.warn('Dynamic buttons generation failed:', error);
      });
    } catch (error: any) {
      console.error('Error transcribing audio:', error);
      const errorInfo = handleApiError(error);
      toast({
        variant: "destructive",
        title: errorInfo.title,
        description: errorInfo.description,
      })
    }
  }

  // useEffect getting triggered when the input state is updated, basically make the avatar to talk
  useEffect(() => {
    async function speak() {
      if (!input || !avatar.current || !data?.sessionId) return;
      
      try {
        // Start speaking immediately without waiting for completion
        const speakPromise = avatar.current.speak({ 
          taskRequest: { 
            text: input, 
            sessionId: data.sessionId! 
          } 
        });
        
        // Don't await - let it run in background for faster response
        speakPromise.catch((err: any) => {
          console.error('Avatar speak error:', err);
        });
        
      } catch (err: any) {
        console.error('Avatar speak setup error:', err);
      }
    }

    speak();
  }, [input]);


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

        // Automatically start the avatar session
        await grab();

        // Start automatic voice detection after avatar is ready
        setTimeout(() => {
          startContinuousListening();
        }, 1000); // Wait 3 seconds for avatar to be ready

        // Add user interaction handler for Android autoplay
        const handleUserInteraction = () => {
          if (mediaStream.current && mediaStream.current.paused) {
            mediaStream.current.play().catch(console.error);
          }
        };

        document.addEventListener('touchstart', handleUserInteraction, { once: true });
        document.addEventListener('click', handleUserInteraction, { once: true });

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
      // Cleanup timeout
      clearTimeout(timeout);
      
      // Cleanup camera analysis interval
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    }

  }, []);



// Function to initiate the avatar with optimized loading and progress tracking
async function grab() {
  setStartLoading(true);
  setStartAvatarLoading(true);
  setLoadingProgress(0);
  
  try {
    // Step 1: Get access token (20% progress)
    const tokenResponse = await getAccessToken();
    setLoadingProgress(20);
    
    const token = tokenResponse.data.data.token;

    // Step 2: Initialize avatar API (40% progress)
    if (!avatar.current) {
      avatar.current = new StreamingAvatarApi(
        new Configuration({ accessToken: token })
      );
    }
    setLoadingProgress(40);

    // Step 3: Create avatar session (70% progress)
    const res = await avatar.current!.createStartAvatar(
      {
        newSessionRequest: {
          quality: "low", // Use low quality for faster response
          avatarName: import.meta.env.VITE_HEYGEN_AVATARID,
          voice: { voiceId: import.meta.env.VITE_HEYGEN_VOICEID }
        }
      },
    );
    
    console.log('Avatar session created:', res);
    setLoadingProgress(70);
    
    // Step 4: Set up video stream (90% progress)
    setData(res);
    setStream(avatar.current!.mediaStream);
    setIsSessionStarted(true);
    
    // Initialize UI components immediately
    setDynamicButtons([
      "Mind-Bending Mysteries",
      "Money Magic & Mayhem", 
      "Love & Laughter Therapy",
      "Life's Comedy Coach"
    ]);
    
    // Note: Don't clear media context here as it might be needed for ongoing analysis
    
    setLoadingProgress(100);
    
    // Clear loading states
    setStartLoading(false);
    setStartAvatarLoading(false);
    
    // Start voice chat and pre-warm in parallel (non-blocking)
    Promise.all([
      startContinuousListening(),
      preWarmAvatarForResponse()
    ]).catch(error => {
      console.warn('Background initialization failed:', error);
    });
    
    // Add initial greeting message after a longer delay to ensure avatar is fully ready
    setTimeout(async () => {
      try {
        console.log('🎭 Avatar greeting: Starting initial greeting...');
        await avatar.current!.speak({ 
          taskRequest: { 
            text: "Hello My name is 6, your personal assistant. How can I help you today?", 
            sessionId: res.sessionId 
          } 
        });
        console.log('🎭 Avatar greeting: Greeting completed successfully');
      } catch (error) {
        console.warn('Initial greeting failed:', error);
      }
    }, 3000); // 3 second delay to ensure avatar is fully ready and pre-warm is complete

  } catch (error: any) {
    console.error('Avatar initialization failed:', error.message);
    setStartAvatarLoading(false);
    setStartLoading(false);
    setLoadingProgress(0); 
    toast({
      variant: "destructive",
      title: "Uh oh! Something went wrong.",
      description: error.response?.data?.message || error.message,
    })
  }
};

//Function to stop the avatar
async function stop() {
  setStopAvatarLoading(true);
  try {
    await avatar.current?.stopAvatar({ stopSessionRequest: { sessionId: data?.sessionId } });
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

// Camera functions
const handleCameraClick = async () => {
  if (isCameraActive) {
    // Stop camera
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    
    // Clear analysis interval
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
    
    setIsCameraActive(false);
    setIsAnalyzing(false);
    
    toast({
      title: "📸 Camera Deactivated",
      description: "I'm no longer watching. Click the camera button to start again! 👋",
    });
  } else {
    // Start camera with rear-facing preference
    try {
      // Try to get rear-facing camera first
      let stream: MediaStream;
      
      try {
        // Request rear-facing/primary camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 320 },
            height: { ideal: 240 },
            facingMode: { ideal: 'environment' } // Rear-facing camera
          },
          audio: false
        });
      } catch (rearError) {
        console.log('Rear camera not available, trying any camera...');
        // Fallback to any available camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 320 },
            height: { ideal: 240 }
          },
          audio: false
        });
      }
      
      setCameraStream(stream);
      setIsCameraActive(true);
      
      // Camera is now passive - only analyzes when user asks something
      // No automatic analysis interval
      
      toast({
        title: "📸 Camera Activated!",
        description: "I'm now watching! Ask me 'what do you see?' or 'describe what you see' to analyze! 👁️",
      });
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast({
        variant: "destructive",
        title: "Camera Error",
        description: "Could not access camera. Please check permissions and try again.",
      });
    }
  }
};

const handleMotionDetected = () => {
  // Motion detected - user is moving
  console.log('👀 Ooh! I see some movement! Someone is getting active!');
};

const handleMotionStopped = async () => {
  if (isAnalyzing || isAvatarSpeaking) return; // Prevent analysis while avatar is speaking or already analyzing
  
  console.log('🎭 Time to analyze this masterpiece! Let me put on my comedy glasses...');
  setIsAnalyzing(true);
  
  try {
    // Capture current frame for analysis
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!cameraVideoRef.current || !ctx) return;
    
    canvas.width = cameraVideoRef.current.videoWidth;
    canvas.height = cameraVideoRef.current.videoHeight;
    ctx.drawImage(cameraVideoRef.current, 0, 0);
    
    // Convert to base64 for OpenAI Vision API
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    // Analyze with OpenAI Vision using optimized settings
    const response = await createApiCall(
      async () => {
        const stream = await openai.chat.completions.create({
          model: "gpt-4o", // Updated to use gpt-4o model
          messages: [
            {
              role: "system",
              content: `You are a hilarious AI that analyzes images with humor and wit! Your analysis should be:
              - Extremely funny and entertaining
              - Use puns, jokes, and witty observations about what you see
              - Be enthusiastic and make people laugh
              - Add humorous commentary about facial expressions, poses, or situations
              - Make funny comparisons or references
              - Keep it light-hearted and positive
              - Always end with a funny observation or joke
              - Keep responses concise (under 200 characters) for real-time display
              - Write as if you're speaking directly to the person (no emojis in speech)
              - Use conversational, natural language that sounds good when spoken aloud`
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this image and provide a hilarious, witty description of what you see! Focus on the person's facial expression, body language, and any notable details. Make it funny and entertaining! Speak directly to the person as if you're commenting on what they're doing right now."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imageData
                  }
                }
              ]
            }
          ],
          max_tokens: 1000,
          stream: true // Enable streaming for faster response
        });
        
        // Process the stream and return the full response
        let fullResponse = '';
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            fullResponse += content;
          }
        }
        return { choices: [{ message: { content: fullResponse } }] } as any;
      },
      { timeout: 45000, retries: 2 }
    );
    
    const fullAnalysis = response.choices[0].message.content || '';
    
    // Add the analysis to the queue for avatar speech
    if (fullAnalysis.trim()) {
      analysisQueueRef.current.push(fullAnalysis.trim());
      if (!isProcessingQueueRef.current) {
        processAnalysisQueue();
      }
    }
    
    console.log('🎪 My hilarious analysis:', fullAnalysis);
    
  } catch (error) {
    console.error('Error analyzing image:', error);
  } finally {
    setIsAnalyzing(false);
  }
};

// Handle vision analysis when user asks about what they see
const handleVisionAnalysis = async (userQuestion: string) => {
  if (isAnalyzing || isAvatarSpeaking) return; // Prevent analysis while avatar is speaking or already analyzing
  
  console.log('🎭 User asked about vision! Let me analyze what I see...');
  setIsAnalyzing(true);
  
  try {
    // Capture current frame for analysis
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!cameraVideoRef.current || !ctx) return;
    
    canvas.width = cameraVideoRef.current.videoWidth;
    canvas.height = cameraVideoRef.current.videoHeight;
    ctx.drawImage(cameraVideoRef.current, 0, 0);
    
    // Convert to base64 for OpenAI Vision API
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    // Analyze with OpenAI Vision using conversational approach
    const response = await createApiCall(
      async () => {
        const stream = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a helpful AI assistant that analyzes images in a natural, conversational way. When someone asks you about what you see, respond as if you're having a normal conversation with them. Be friendly, descriptive, and helpful. Keep responses conversational and under 200 words.`
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `The user asked: "${userQuestion}". Please analyze this image and respond naturally to their question. Describe what you see in a conversational way that directly answers their question.`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imageData
                  }
                }
              ]
            }
          ],
          max_tokens: 300,
          stream: true
        });
        
        // Process the stream and return the full response
        let fullResponse = '';
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            fullResponse += content;
          }
        }
        return { choices: [{ message: { content: fullResponse } }] } as any;
      },
      { timeout: 45000, retries: 2 }
    );
    
    const analysis = response.choices[0].message.content || '';
    
    // Add the analysis to the queue for avatar speech
    if (analysis.trim()) {
      analysisQueueRef.current.push(analysis.trim());
      if (!isProcessingQueueRef.current) {
        processAnalysisQueue();
      }
    }
    
    console.log('👁️ Vision analysis response:', analysis);
    
  } catch (error) {
    console.error('Error analyzing vision:', error);
    toast({
      variant: "destructive",
      title: "Vision Analysis Error",
      description: "Sorry, I couldn't analyze what I see right now. Please try again.",
    });
  } finally {
    setIsAnalyzing(false);
  }
};

// When the user selects the pre-defined prompts, this useEffect will get triggered
useEffect(() => {
  if (selectedPrompt) {
    // Build messages array with conversation history and media context
    const messages: any[] = [];
    
    // Always add system prompt first
    messages.push({
      role: 'system',
      content: 'You are a witty AI assistant. Keep responses under 100 words, be engaging and conversational.'
    });
    
    // Add media analysis if available (check both state and ref)
    const effectiveMediaContext = hasMediaContext || mediaContextRef.current.hasContext;
    const effectiveAnalysis = currentMediaAnalysis || mediaContextRef.current.analysis;
    const effectiveFileName = mediaFileName || mediaContextRef.current.fileName;
    
    if (effectiveMediaContext && effectiveAnalysis && effectiveFileName) {
      console.log('🎯 Media context is active for button!', { 
        hasMediaContext, 
        mediaFileName, 
        currentMediaAnalysis,
        refContext: mediaContextRef.current
      });
      
      // Create a more natural, conversational context message
      const fileType = effectiveFileName.split('.').pop()?.toLowerCase();
      const mediaType = fileType && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileType) ? 'image' :
                       fileType && ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(fileType) ? 'video' :
                       fileType && ['txt', 'pdf', 'doc', 'docx'].includes(fileType) ? 'document' : 'file';
      
      messages.push({
        role: 'assistant',
        content: `I've been looking at your ${mediaType} "${effectiveFileName}". Here's what I noticed: ${effectiveAnalysis}\n\nFeel free to ask me anything about it - I'm here to help you understand or work with this ${mediaType}!`
      });
    } else {
      console.log('❌ No media context for button', { 
        hasMediaContext, 
        mediaFileName, 
        currentMediaAnalysis,
        refContext: mediaContextRef.current
      });
    }
    
    // Add conversation history
    messages.push(...conversationHistory);
    
    // Add current user message
    messages.push({ role: 'user', content: selectedPrompt });
    
    createApiCall(
      () => openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: 150, // Reduced for faster response
        temperature: 0.8
      }),
      { timeout: 20000, retries: 2 }
    ).then((aiResponse: any) => {
      setInput(aiResponse.choices[0].message.content || '');
    }).catch(error => {
      console.log(error);
      const errorInfo = handleApiError(error);
      toast({
        variant: "destructive",
        title: errorInfo.title,
        description: errorInfo.description,
      })
    })
  }
}, [selectedPrompt, hasMediaContext, currentMediaAnalysis, mediaFileName])


// When the stream gets the data, The avatar video will gets played
useEffect(() => {
  if (stream && mediaStream.current) {
    console.log('Setting up video stream:', stream);
    console.log('Video element:', mediaStream.current);
    
    mediaStream.current.srcObject = stream;
    
    // Handle video loading and playing for mobile compatibility
    const handleLoadedMetadata = () => {
      console.log('Video metadata loaded');
      if (mediaStream.current) {
        // Set maximum volume for avatar audio
        mediaStream.current.volume = 1.0;
        mediaStream.current.muted = false;
        
        // Set up audio context for volume boost
        setupAudioContext();
        
        // Create a hidden audio element for volume boosting
        if (!audioElementRef.current) {
          audioElementRef.current = document.createElement('audio');
          audioElementRef.current.style.display = 'none';
          audioElementRef.current.volume = Math.min(volumeLevel, 1.0);
          document.body.appendChild(audioElementRef.current);
        }
        
        // Connect video audio to gain node for volume boost
        if (audioContextRef.current && gainNodeRef.current && mediaStream.current) {
          try {
            // Resume audio context if suspended
            if (audioContextRef.current.state === 'suspended') {
              audioContextRef.current.resume();
            }
            
            const source = audioContextRef.current.createMediaElementSource(mediaStream.current);
            source.connect(gainNodeRef.current);
            console.log('Audio connected to gain node for volume boost');
          } catch (error) {
            console.warn('Could not connect audio to gain node:', error);
            // Fallback: just set video volume higher
            mediaStream.current.volume = Math.min(volumeLevel, 1.0);
          }
        }
        
        mediaStream.current.play().catch(error => {
          console.error('Autoplay failed:', error);
          // Try to play with user interaction
          document.addEventListener('touchstart', () => {
            if (mediaStream.current) {
              mediaStream.current.play().catch(console.error);
            }
          }, { once: true });
        });
      }
    };

    const handleCanPlay = () => {
      console.log('Video can play');
    };

    const handleError = (error: any) => {
      console.error('Video error:', error);
    };

    mediaStream.current.addEventListener('loadedmetadata', handleLoadedMetadata);
    mediaStream.current.addEventListener('canplay', handleCanPlay);
    mediaStream.current.addEventListener('error', handleError);

    // Cleanup function
    return () => {
      if (mediaStream.current) {
        mediaStream.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        mediaStream.current.removeEventListener('canplay', handleCanPlay);
        mediaStream.current.removeEventListener('error', handleError);
      }
    };
  }
}, [stream]);

// Set up small avatar video stream when camera is active
useEffect(() => {
  if (isCameraActive && stream && smallAvatarRef.current) {
    console.log('Setting up small avatar video stream');
    smallAvatarRef.current.srcObject = stream;
    
    const handleSmallAvatarLoadedMetadata = () => {
      console.log('Small avatar video metadata loaded');
      if (smallAvatarRef.current) {
        
        smallAvatarRef.current.play().catch(error => {
          console.error('Small avatar autoplay failed:', error);
        });
      }
    };

    const handleSmallAvatarError = (error: any) => {
      console.error('Small avatar video error:', error);
    };

    smallAvatarRef.current.addEventListener('loadedmetadata', handleSmallAvatarLoadedMetadata);
    smallAvatarRef.current.addEventListener('error', handleSmallAvatarError);

    // Cleanup function
    return () => {
      if (smallAvatarRef.current) {
        smallAvatarRef.current.removeEventListener('loadedmetadata', handleSmallAvatarLoadedMetadata);
        smallAvatarRef.current.removeEventListener('error', handleSmallAvatarError);
      }
    };
  }
}, [isCameraActive, stream]);

// Show landing page if session hasn't started
if (!isSessionStarted && !startLoading && !startAvatarLoading) {
  return (
    <>
      <Toaster />
    </>
  );
}

return (
  <>
    <Toaster />
    <div 
      className={`h-screen w-screen relative overflow-hidden transition-all duration-300 ${
        isDragOver ? 'ring-4 ring-blue-400 ring-opacity-50 bg-blue-900/20' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Brand Header */}
      <Suspense fallback={<div className="h-16 bg-gray-100 animate-pulse"></div>}>
        <BrandHeader />
      </Suspense>

      {/* Fullscreen Video - Avatar or Camera */}
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {isCameraActive && cameraStream ? (
          <Suspense fallback={<div className="w-full h-full bg-black flex items-center justify-center text-white">Loading camera...</div>}>
            <CameraVideo
              ref={cameraVideoRef}
              stream={cameraStream}
              onMotionDetected={handleMotionDetected}
              onMotionStopped={handleMotionStopped}
            />
          </Suspense>
        ) : (
          <Video ref={mediaStream} />
        )}
      </div>

      {/* Small Avatar Video - Top Left Corner (when camera is active) */}
      {isCameraActive && stream && (
        <div className="absolute top-20 left-4 w-24 h-32 z-20 bg-black rounded-lg overflow-hidden shadow-lg">
          <video 
            ref={smallAvatarRef}
            playsInline 
            autoPlay 
            loop
            className="w-full h-full object-cover rounded-lg" 
            style={{ 
              backgroundColor: '#000'
            }}
          />
        </div>
      )}

      {/* Close button for camera mode */}
      {isCameraActive && cameraStream && (
        <button
          onClick={handleCameraClick}
          className="absolute top-4 right-4 w-8 h-8 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-lg font-bold transition-colors z-30"
          title="Exit Vision Mode"
        >
          ×
        </button>
      )}

      {/* Enhanced Loading overlay with progress */}
      {(startLoading || startAvatarLoading) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 z-20">
          <div className="text-white text-center max-w-md mx-auto p-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-6"></div>
            <div className="text-2xl mb-4">Getting my funny face ready...</div>
            
            
            <div className="text-sm opacity-75">
              {loadingProgress < 50 ? "Preparing jokes and witty comebacks!" : 
               loadingProgress < 80 ? "Setting up the stage for comedy!" :
               "Almost ready to entertain!"}
            </div>
            
            <div className="text-xs mt-2 opacity-50">
              {loadingProgress}% complete
            </div>
          </div>
        </div>
      )}

      {/* Camera and Paper clip buttons - positioned above avatar's hands */}
      {isSessionStarted && (
        <div className="absolute top-2/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex gap-4 z-20">
          <Button
            variant="outline"
            size="icon"
            className={`h-12 w-20 ${
              isCameraActive 
                ? 'bg-red-600/80 border-red-500 text-white hover:bg-red-700/80 shadow-lg' 
                : 'bg-amber-700/80 border-amber-600 text-amber-100 hover:bg-amber-800/80 shadow-lg'
            }`}
            style={{
              borderRadius: '50px',
              border: '4px solid #8B4513',
              borderTop: '4px solid #8B4513',
              borderBottom: '4px solid #8B4513',
              position: 'relative',
              overflow: 'hidden'
            }}
            onClick={handleCameraClick}
          >
            <div 
              style={{
                position: 'absolute',
                top: '-4px',
                left: '-4px',
                right: '-4px',
                bottom: '-4px',
                border: '2px solid #2D2D2D',
                borderRadius: '50px',
                pointerEvents: 'none'
              }}
            />
            <div 
              style={{
                position: 'absolute',
                top: '-2px',
                left: '-2px',
                right: '-2px',
                bottom: '-2px',
                border: '1px solid #C0C0C0',
                borderRadius: '50px',
                pointerEvents: 'none'
              }}
            />
            <Camera className="h-6 w-6" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={`h-12 w-20 shadow-lg transition-all duration-300 hover:scale-110 ${
              hasMediaContext 
                ? 'bg-green-600/80 border-green-500 text-white hover:bg-green-700/80' 
                : 'bg-amber-700/80 border-amber-600 text-amber-100 hover:bg-amber-800/80'
            }`}
            style={{
              borderRadius: '50px',
              border: '4px solid #8B4513',
              borderTop: '4px solid #8B4513',
              borderBottom: '4px solid #8B4513',
              position: 'relative',
              overflow: 'hidden'
            }}
            onClick={() => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.accept = '.txt,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.avi,.mkv,.webm';
              fileInput.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleFileUpload(file);
              };
              fileInput.click();
            }}
            title={hasMediaContext ? `Currently analyzing: ${mediaFileName}` : "Upload a file to discuss"}
          >
            <div 
              style={{
                position: 'absolute',
                top: '-4px',
                left: '-4px',
                right: '-4px',
                bottom: '-4px',
                border: '2px solid #2D2D2D',
                borderRadius: '50px',
                pointerEvents: 'none'
              }}
            />
            <div 
              style={{
                position: 'absolute',
                top: '-2px',
                left: '-2px',
                right: '-2px',
                bottom: '-2px',
                border: '1px solid #C0C0C0',
                borderRadius: '50px',
                pointerEvents: 'none'
              }}
            />
            <Paperclip className={`h-6 w-6 transition-transform duration-200 ${hasMediaContext ? 'animate-pulse' : ''}`} />
          </Button>
        </div>
      )}

      {/* Drag and drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white/90 dark:bg-gray-800/90 rounded-lg p-8 text-center shadow-2xl">
            <Paperclip className="h-16 w-16 mx-auto mb-4 text-blue-500 animate-bounce" />
            <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
              Drop your file here!
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              I'll analyze it and we can chat about it
            </p>
          </div>
        </div>
      )}

      {/* Controls overlay at bottom - only show after session starts */}
      {isSessionStarted && (
        <div className='absolute bottom-0 left-0 right-0 flex flex-col justify-center p-2 z-10'>
          <div className="w-full max-w-4xl mx-auto">
            <Suspense fallback={<div className="h-12 bg-gray-200 animate-pulse rounded-lg mb-4"></div>}>
              <Badges
                setSelectedPrompt={setSelectedPrompt}
                onFileUpload={handleFileUpload}
                onCameraClick={handleCameraClick}
                isCameraActive={isCameraActive}
                dynamicButtons={dynamicButtons}
                hasMediaContext={hasMediaContext}
                mediaFileName={mediaFileName}
                onClearContext={clearMediaContext}
              />
            </Suspense>
            {/* <Suspense fallback={<div className="h-16 bg-gray-200 animate-pulse rounded-full"></div>}>
              <MicButton
                isSpeaking={isSpeaking}
                onClick={isSpeaking ? handleStopSpeaking : handleStartSpeaking}
                stopAvatar={stop}
                grab={grab}
                avatarStartLoading={startAvatarLoading}
                avatarStopLoading={stopAvatarLoading}
              />
            </Suspense> */}
          </div>
        </div>
      )}
    </div>
  </>
);
}

export default App;
