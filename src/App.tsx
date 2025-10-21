/*eslint-disable*/
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import OpenAI from 'openai';
import { Configuration, NewSessionData, StreamingAvatarApi } from '@heygen/streaming-avatar';
import { getAccessToken } from './services/api';
import { Video } from './components/reusable/Video';
import { createApiCall } from './utils/api-helpers';
import { Button } from "@/components/ui/button";
import { Camera, Paperclip } from "lucide-react";

// Lazy load heavy components for faster initial load
const Badges = lazy(() => import('./components/reusable/Badges').then(module => ({ default: module.Badges })));
const BrandHeader = lazy(() => import('./components/reusable/BrandHeader'));
const CameraVideo = lazy(() => import('./components/reusable/CameraVideo').then(module => ({ default: module.CameraVideo })));


function App() {

  const [startLoading, setStartLoading] = useState<boolean>(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [input, setInput] = useState<string>('');
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string, content: string}>>([]);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [stream, setStream] = useState<MediaStream>();
  const [data, setData] = useState<NewSessionData>();
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);

  const [startAvatarLoading, setStartAvatarLoading] = useState<boolean>(false);
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
  
  // Ref to track avatar speaking state for voice detection
  const isAvatarSpeakingRef = useRef<boolean>(false);
  
  // Flag to prevent new speech when user is talking
  const isUserInterruptingRef = useRef<boolean>(false);
  
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

  // Function to interrupt avatar speech when user starts talking
  const interruptAvatarSpeech = () => {
    console.log('🛑 Interrupting avatar speech to listen to user!');
    
    // Set interruption flag to prevent new speech
    isUserInterruptingRef.current = true;
    
    // Immediately set speaking state to false
    setIsAvatarSpeaking(false);
    isAvatarSpeakingRef.current = false;
    
    // Clear any pending analysis queue
    analysisQueueRef.current = [];
    isProcessingQueueRef.current = false;
    
    // Clear the input to stop any pending speech
    setInput('');
    
    // Try multiple methods to stop current avatar speech
    if (avatar.current && data?.sessionId) {
      try {
        // Method 1: Try to stop current speech
        if (typeof (avatar.current as any).stop === 'function') {
          console.log('🛑 Attempting to stop avatar speech via stop() method');
          (avatar.current as any).stop();
        }
        
        // Method 2: Try to cancel current session
        if (typeof (avatar.current as any).cancel === 'function') {
          console.log('🛑 Attempting to cancel avatar speech via cancel() method');
          (avatar.current as any).cancel();
        }
        
        // Method 3: Try to end current session
        if (typeof (avatar.current as any).endSession === 'function') {
          console.log('🛑 Attempting to end avatar session');
          (avatar.current as any).endSession();
        }
        
      } catch (error) {
        console.log('Could not stop avatar speech:', error);
      }
    }
    
    console.log('🛑 Interruption completed - avatar should now be silent');
    
    // Reset interruption flag after a timeout to prevent permanent blocking
    setTimeout(() => {
      if (isUserInterruptingRef.current) {
        console.log('🛑 Resetting interruption flag after timeout');
        isUserInterruptingRef.current = false;
      }
    }, 10000); // 10 second timeout
  };

  // Function to process analysis queue with reduced latency
  const processAnalysisQueue = async () => {
    if (isProcessingQueueRef.current || analysisQueueRef.current.length === 0) return;
    
    // Check if user is interrupting - don't process queue
    if (isUserInterruptingRef.current) {
      console.log('🛑 Skipping analysis queue - user is interrupting');
      return;
    }
    
    isProcessingQueueRef.current = true;
    const analysis = analysisQueueRef.current.shift();
    
    if (analysis && avatar.current && data?.sessionId) {
      try {
        console.log('🎭 Processing analysis queue - Avatar starting to speak:', analysis);
        setIsAvatarSpeaking(true);
        isAvatarSpeakingRef.current = true;
        
        // Start speaking immediately without waiting
        const speakPromise = avatar.current.speak({ 
          taskRequest: { 
            text: analysis, 
            sessionId: data.sessionId 
          } 
        });
        
        // Process next item in queue immediately after starting speech
        speakPromise.then(() => {
          console.log('🎭 Analysis queue speech completed');
          // Reduced delay - only wait for speech to complete
          setTimeout(() => {
            setIsAvatarSpeaking(false);
            isAvatarSpeakingRef.current = false;
            isProcessingQueueRef.current = false;
            // Process next item immediately if available
            if (analysisQueueRef.current.length > 0) {
              processAnalysisQueue();
            }
          }, 1000); // Reduced from 2000ms to 500ms
        }).catch((speakError) => {
          console.error('Error making avatar speak:', speakError);
          setIsAvatarSpeaking(false);
          isAvatarSpeakingRef.current = false;
          isProcessingQueueRef.current = false;
        });
        
      } catch (speakError) {
        console.error('Error making avatar speak:', speakError);
        setIsAvatarSpeaking(false);
        isAvatarSpeakingRef.current = false;
        isProcessingQueueRef.current = false;
      }
    } else {
      isProcessingQueueRef.current = false;
    }
  };


  // Function to generate dynamic buttons based on conversation context
  // const generateDynamicButtons = async (conversation: Array<{role: string, content: string}>) => {
  //   try {
  //     const response = await createApiCall(
  //       () => openai.chat.completions.create({
  //         model: 'gpt-3.5-turbo',
  //         messages: [
  //           {
  //             role: 'system',
  //             content: `Generate 4 witty button prompts (1-4 words each) based on conversation. Return only the 4 button texts, one per line.`
  //           },
  //           {
  //             role: 'user',
  //             content: `Context: ${conversation.slice(-2).map(msg => msg.content).join(' ')}` // Only use last 2 messages for faster processing
  //           }
  //         ],
  //         max_tokens: 100, // Reduced for faster response
  //         temperature: 0.7
  //       }),
  //     );
      
  //     const buttons = response.choices[0].message.content?.split('\n').filter(btn => btn.trim()) || [];
  //     setDynamicButtons(buttons);
  //   } catch (error) {
  //     console.error('Error generating dynamic buttons:', error);
  //     // Fallback to default buttons
  //     setDynamicButtons([
  //       "Mind-Bending Mysteries",
  //       "Money Magic & Mayhem", 
  //       "Love & Laughter Therapy",
  //       "Life's Comedy Coach"
  //     ]);
  //   }
  // };

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
        const silenceTimeout = 1500; // 1.5 seconds of silence (increased for better reliability)
        const voiceThreshold = 40; // Lowered voice detection threshold for better sensitivity

        const checkForVoice = () => {
          analyser.getByteFrequencyData(dataArray);
          const avgVolume = dataArray.reduce((a, b) => a + b) / bufferLength;

          // Always check for interruption when avatar is speaking, regardless of recording state
          if (isAvatarSpeakingRef.current && avgVolume > voiceThreshold) {
            console.log('🛑 User voice detected while avatar is speaking - interrupting!', {
              avgVolume,
              threshold: voiceThreshold,
              isRecording,
              isAvatarSpeaking: isAvatarSpeakingRef.current
            });
            interruptAvatarSpeech();
          }

          // Add more detailed logging for debugging
          if (avgVolume > voiceThreshold * 0.5) { // Log when approaching threshold
            console.log('🎤 Voice activity detected:', { 
              avgVolume, 
              threshold: voiceThreshold, 
              isRecording, 
              isAvatarSpeaking: isAvatarSpeakingRef.current,
              willInterrupt: isAvatarSpeakingRef.current && avgVolume > voiceThreshold
            });
          }

          if (avgVolume > voiceThreshold && !isRecording) {
            // Voice detected, start recording
            console.log('🎤 Someone is trying to talk to me! Let me listen...', { 
              avgVolume, 
              threshold: voiceThreshold,
              hasMediaContext,
              mediaFileName,
              isAvatarSpeaking
            });
            
            // Note: Interruption is now handled above in the separate check
            
            isRecording = true;
            silenceStart = null;
            
            try {
              mediaRecorder.current = new MediaRecorder(stream);
              audioChunks.current = [];

              mediaRecorder.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                  audioChunks.current.push(event.data);
                  console.log('🎤 Audio chunk received:', event.data.size);
                }
              };

              mediaRecorder.current.onstop = () => {
                console.log('🎤 Recording stopped, processing audio...', { 
                  chunksCount: audioChunks.current.length,
                  totalSize: audioChunks.current.reduce((sum, chunk) => sum + chunk.size, 0)
                });
                
                if (audioChunks.current.length > 0) {
                  const audioBlob = new Blob(audioChunks.current, {
                    type: 'audio/wav',
                  });
                  audioChunks.current = [];
                  transcribeAudio(audioBlob);
                } else {
                  console.warn('🎤 No audio chunks recorded');
                }
                isRecording = false;
              };

              mediaRecorder.current.onerror = (error) => {
                console.error('🎤 MediaRecorder error:', error);
                isRecording = false;
              };

              mediaRecorder.current.start();
              console.log('🎤 Recording started');
            } catch (recorderError) {
              console.error('🎤 Error creating MediaRecorder:', recorderError);
              isRecording = false;
            }
          } else if (avgVolume < voiceThreshold && isRecording) {
            // Voice stopped, check for silence
            if (!silenceStart) silenceStart = Date.now();

            if (Date.now() - silenceStart >= silenceTimeout) {
              console.log('🤫 Ah, the silence! Let me process what you said...', {
                silenceDuration: Date.now() - silenceStart,
                chunksCount: audioChunks.current.length
              });
              if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
                mediaRecorder.current.stop();
              }
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
      });
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
            max_tokens: 150
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
            max_tokens: 150
          }),
          { timeout: 60000, retries: 2 }
        );

        URL.revokeObjectURL(videoUrl);

      } else if (file.type.startsWith('text/')) {
        // Handle text files with size limits
        const fileContent = await file.text();
        const maxTextLength = 50000; // 50KB text limit
        
        if (fileContent.length > maxTextLength) {
          return;
        }
        
        const prompt = `Analyze this text file "${file.name}":\n\n${fileContent}\n\nProvide key insights.`;
        
        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              { role: 'user', content: prompt }
            ],
            max_tokens: 150
          }),
          { timeout: 30000, retries: 2 }
        );

      } else {
        // For other file types, provide basic analysis
        const prompt = `File: ${file.name} (${file.type}). What can I do with this file?`;
        
        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              { role: 'user', content: prompt }
            ],
            max_tokens: 150
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
      
      
      
      // Make avatar ask what help the user needs in a natural, ChatGPT-like way
      const fileType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
      const helpPrompts = [
        `I just took a look at your ${fileType} "${file.name}" - this is really interesting! I'm genuinely curious about what you'd like to explore about it. What caught your attention?`,
        `Your ${fileType} "${file.name}" caught my eye! I'd love to dive into whatever aspects interest you most. What would you like to know about it?`,
        `I've been examining your ${fileType} "${file.name}" and I'm finding it quite engaging. What questions do you have? I'm excited to explore it with you.`,
        `This ${fileType} "${file.name}" is fascinating! I'm genuinely curious - what drew you to this? What would you like to focus on?`,
        `I just finished analyzing your ${fileType} "${file.name}" and wow, there's a lot to unpack here! What aspects are you most interested in discussing?`,
        `Your ${fileType} "${file.name}" is really compelling! I'd love to hear your thoughts about it. What sparked your interest in this particular ${fileType}?`,
        `I've been studying your ${fileType} "${file.name}" and I'm genuinely impressed. What would you like to explore together? I'm here to help you understand or discuss whatever interests you most.`
      ];
      
      const randomHelpPrompt = helpPrompts[Math.floor(Math.random() * helpPrompts.length)];
      setInput(randomHelpPrompt);
      
    } catch (error: any) {
      console.error('Error processing file:', error);
    }
  };

  // Function to transcribe the audio to text and then get the respective response of the given prompt
  async function transcribeAudio(audioBlob: Blob) {
    try {
      console.log('🎤 Starting audio transcription...', { 
        blobSize: audioBlob.size, 
        hasMediaContext, 
        mediaFileName 
      });
      
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
        { timeout: 30000, retries: 3 } // Increased timeout and retries for better reliability
      );

      console.log('🎤 Transcription response received:', transcriptionResponse);

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
        return;
      }
      
      // Check if transcription is valid
      if (!transcription || typeof transcription !== 'string' || transcription.trim().length === 0) {
        console.error('Invalid or empty transcription response:', transcriptionResponse);
        return;
      }

      console.log('🎤 Transcription successful:', transcription);
      
      // Reset interruption flag since user has finished speaking
      isUserInterruptingRef.current = false;

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

      console.log('🎤 Vision check:', { 
        transcription: transcription, 
        isVisionRequest, 
        isCameraActive, 
        hasCameraRef: !!cameraVideoRef.current 
      });

      // If user is asking about vision and camera is active, trigger analysis
      if (isVisionRequest && isCameraActive && cameraVideoRef.current) {
        console.log('👁️ User is asking about vision! Let me analyze what I see...');
        handleVisionAnalysis(transcription);
        return; // Don't process as regular conversation
      }
      
      // Check cache first for faster response (but skip cache if media context is active)
      const cacheKey = transcription.toLowerCase().trim();
      const cachedResponse = responseCache.current.get(cacheKey);
      
      console.log('🎤 Cache check:', { 
        cacheKey, 
        hasCachedResponse: !!cachedResponse, 
        hasMediaContext, 
        willUseCache: !!(cachedResponse && !hasMediaContext) 
      });
      
      if (cachedResponse && !hasMediaContext) {
        console.log('🚀 Using cached response for faster reply!');
        setInput(cachedResponse);
        
        // Update conversation history
        const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
        setConversationHistory(updatedHistory);
        
        const finalHistory = [...updatedHistory, { role: 'assistant', content: cachedResponse }];
        setConversationHistory(finalHistory);
        return;
      }
      
      // Build messages array with conversation history and media context
      const messages: any[] = [];
      
      // Always add system prompt first (optimized for fewer tokens)
      messages.push({
        role: 'system',
        content: 'You are a helpful AI assistant. Be conversational, curious, and engaging. Keep responses under 150 words. When discussing media, be specific and ask follow-up questions.'
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
        
        // Create concise context messages (optimized for fewer tokens)
        const contextPrompts = [
          `I analyzed your ${mediaType} "${effectiveFileName}": ${effectiveAnalysis}\n\nWhat would you like to explore?`,
          `Your ${mediaType} "${effectiveFileName}": ${effectiveAnalysis}\n\nWhat interests you most?`,
          `I examined your ${mediaType} "${effectiveFileName}": ${effectiveAnalysis}\n\nWhat questions do you have?`,
          `This ${mediaType} "${effectiveFileName}": ${effectiveAnalysis}\n\nWhat would you like to discuss?`
        ];
        
        const randomContextPrompt = contextPrompts[Math.floor(Math.random() * contextPrompts.length)];
        messages.push({
          role: 'assistant',
          content: randomContextPrompt
        });
      } else {
        console.log('❌ No media context', { 
          hasMediaContext, 
          mediaFileName, 
          currentMediaAnalysis,
          refContext: mediaContextRef.current
        });
      }
      
      // Add conversation history (limit to last 6 messages to control token usage)
      const limitedHistory = conversationHistory.slice(-6);
      messages.push(...limitedHistory);
      
      // Add current user message
      messages.push({ role: 'user', content: transcription || '' });
      
      // Count approximate tokens for monitoring
      const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
      const estimatedTokens = Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
      console.log('📤 Sending messages to OpenAI:', messages);
      console.log(`📊 Token estimate: ~${estimatedTokens} tokens (${totalChars} characters)`);
      
      // Update conversation history
      const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
      setConversationHistory(updatedHistory);
      
      try {
        const specificResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: messages,
            max_tokens: 150, // Reduced for faster response
            temperature: 0.8
          }),
          { timeout: 30000, retries: 3 } // Increased timeout and retries for better reliability
        );
        
        console.log('📤 OpenAI response received:', specificResponse);
        
        const aiMessage = (specificResponse as any).choices[0].message.content || '';
        
        if (!aiMessage || aiMessage.trim().length === 0) {
          console.error('Empty AI response received');
          return;
        }
        
        console.log('🎤 AI response:', aiMessage);
        
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
        
      } catch (apiError) {
        console.error('🎤 Error in OpenAI API call:', apiError);
        // Don't return here, let the error be caught by the outer try-catch
        throw apiError;
      }
    } catch (error: any) {
      console.error('Error transcribing audio:', error);
      
      // If there's an error and we have media context, try to provide a fallback response
      if (hasMediaContext || mediaContextRef.current.hasContext) {
        console.log('🎤 Providing fallback response due to transcription error');
        const fallbackResponses = [
          "I'm having trouble hearing you clearly - could you try speaking a bit louder or closer to the microphone? I'm really interested in what you have to say about the image!",
          "I didn't quite catch that. Could you repeat what you said about the image? I'm genuinely curious to hear your thoughts.",
          "I'm experiencing some audio issues right now. Can you try asking your question about the image again? I'd love to help you explore it.",
          "I didn't quite hear that clearly. What would you like to know about the image you uploaded? I'm excited to discuss it with you.",
          "I'm having trouble processing your voice right now, but I'm really interested in what you have to say. Could you try again? I'd love to hear your thoughts about the image."
        ];
        
        const randomFallback = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
        setInput(randomFallback);
      }
    }
  }

  // useEffect getting triggered when the input state is updated, basically make the avatar to talk
  useEffect(() => {
    async function speak() {
      if (!input || !avatar.current || !data?.sessionId) return;
      
      // Check if user is interrupting - don't start new speech
      if (isUserInterruptingRef.current) {
        console.log('🛑 Skipping avatar speech - user is interrupting');
        return;
      }
      
      try {
        console.log('🎭 Avatar starting to speak:', input);
        setIsAvatarSpeaking(true);
        isAvatarSpeakingRef.current = true;
        
        // Start speaking immediately without waiting for completion
        const speakPromise = avatar.current.speak({ 
          taskRequest: { 
            text: input, 
            sessionId: data.sessionId! 
          } 
        });
        
        // Handle completion and errors
        speakPromise.then(() => {
          console.log('🎭 Avatar finished speaking');
          setIsAvatarSpeaking(false);
          isAvatarSpeakingRef.current = false;
        }).catch((err: any) => {
          console.error('Avatar speak error:', err);
          setIsAvatarSpeaking(false);
          isAvatarSpeakingRef.current = false;
        });
        
      } catch (err: any) {
        console.error('Avatar speak setup error:', err);
        setIsAvatarSpeaking(false);
        isAvatarSpeakingRef.current = false;
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
  }
};


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
      
    } catch (error) {
      console.error('Error accessing camera:', error);
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
          max_tokens: 150,   
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
          max_tokens: 150,
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
      content: 'You are an intelligent, conversational AI assistant with a warm and engaging personality. Think of yourself as a knowledgeable friend who loves to chat and explore ideas together. Be genuinely curious, ask thoughtful questions, and show real interest in what the user is sharing. When discussing images or media, be specific about what you notice and ask engaging follow-up questions. Use natural language patterns, show personality, and make the conversation flow smoothly. Be helpful, insightful, and encouraging. Keep responses conversational and under 150 words, but don\'t be afraid to show enthusiasm and intelligence.'
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
      
      // Create more natural, ChatGPT-like context messages
      const contextPrompts = [
        `I just took a look at your ${mediaType} "${effectiveFileName}" - this is really interesting! ${effectiveAnalysis}\n\nI'm curious, what drew you to this ${mediaType}? What would you like to explore about it?`,
        `Your ${mediaType} "${effectiveFileName}" caught my attention! Here's what I'm seeing: ${effectiveAnalysis}\n\nWhat aspects are you most interested in discussing?`,
        `I've been examining your ${mediaType} "${effectiveFileName}" and I'm genuinely impressed. ${effectiveAnalysis}\n\nWhat questions do you have about it? I'd love to dive deeper into whatever interests you most.`,
        `This ${mediaType} "${effectiveFileName}" is fascinating! ${effectiveAnalysis}\n\nWhat made you choose this particular ${mediaType}? I'm excited to explore it with you.`,
        `I just finished analyzing your ${mediaType} "${effectiveFileName}" and wow, there's a lot to unpack here! ${effectiveAnalysis}\n\nWhat would you like to focus on? I'm here to help you understand or explore any aspect that interests you.`,
        `Your ${mediaType} "${effectiveFileName}" is really compelling! ${effectiveAnalysis}\n\nI'm genuinely curious - what's your connection to this? What would you like to know more about?`,
        `I've been studying your ${mediaType} "${effectiveFileName}" and I'm finding it quite engaging. ${effectiveAnalysis}\n\nWhat sparked your interest in this? I'd love to hear your thoughts and explore it together.`,
        `This ${mediaType} "${effectiveFileName}" is quite something! ${effectiveAnalysis}\n\nWhat aspects are you most curious about? I'm here to help you understand or discuss whatever interests you most.`
      ];
      
      const randomContextPrompt = contextPrompts[Math.floor(Math.random() * contextPrompts.length)];
      messages.push({
        role: 'assistant',
        content: randomContextPrompt
      });
    } else {
      console.log('❌ No media context for button', { 
        hasMediaContext, 
        mediaFileName, 
        currentMediaAnalysis,
        refContext: mediaContextRef.current
      });
    }
    
    // Add conversation history (limit to last 6 messages to control token usage)
    const limitedHistory = conversationHistory.slice(-6);
    messages.push(...limitedHistory);
    
    // Add current user message
    messages.push({ role: 'user', content: selectedPrompt });
    
    // Count approximate tokens for monitoring
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
    console.log(`📊 Token estimate: ~${estimatedTokens} tokens (${totalChars} characters)`);
    
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
    </>
  );
}

return (
  <>
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
