/*eslint-disable*/
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState, lazy, Suspense, useCallback } from 'react';
import OpenAI from 'openai';
import { Configuration, NewSessionData, StreamingAvatarApi } from '@heygen/streaming-avatar';
import { getAccessToken } from './services/api';
import { Video } from './components/reusable/Video';
import { Toaster } from "@/components/ui/toaster"

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

  // Image/Video analysis conversation state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [analysisStep, setAnalysisStep] = useState<'upload' | 'question' | 'analysis' | 'complete'>('upload');
  const [userQuestion, setUserQuestion] = useState<string>('');
  const [analysisContext, setAnalysisContext] = useState<{
    file: File;
    userQuestion: string;
    analysisResult: string;
  } | null>(null);

  const [startAvatarLoading, setStartAvatarLoading] = useState<boolean>(false);
  const [stopAvatarLoading, setStopAvatarLoading] = useState<boolean>(false);
  const [isSessionStarted, setIsSessionStarted] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  
  // Camera states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState<boolean>(false);
  
  // Preloaded responses for common queries to reduce API calls
  const preloadedResponses = useRef<Map<string, string>>(new Map([
    ['hello', 'Hey there! Great to see you! What can I help you with today?'],
    ['hi', 'Hi! How are you doing? I\'m here to chat!'],
    ['how are you', 'I\'m doing fantastic! Thanks for asking. How about you?'],
    ['what can you do', 'I can chat, tell jokes, help with questions, and just be your friendly AI companion!'],
    ['thank you', 'You\'re very welcome! Happy to help anytime!'],
    ['bye', 'See you later! It was great chatting with you!']
  ]));
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  
  // Pre-warm avatar for faster response
  const preWarmAvatar = useRef<boolean>(false);
  const smallAvatarRef = useRef<HTMLVideoElement>(null);
  
  // Pre-warm avatar with a simple greeting to reduce first response time
  const preWarmAvatarResponse = useCallback(() => {
    if (!preWarmAvatar.current && avatar.current && data?.sessionId) {
      preWarmAvatar.current = true;
      // Send a silent pre-warm message
      avatar.current.speak({ 
        taskRequest: { 
          text: "Hello", 
          sessionId: data.sessionId 
        } 
      }).catch(() => {
        // Ignore pre-warm errors
      });
    }
  }, [avatar, data?.sessionId]);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const analysisQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  
  // Response cache for faster repeated queries
  const responseCache = useRef<Map<string, string>>(new Map());
  
  // Performance tracking - using state for real-time UI updates
  const [performanceMetrics, setPerformanceMetrics] = useState({
    totalRequests: 0,
    averageResponseTime: 0,
    transcriptionTimes: [] as number[],
    openaiTimes: [] as number[],
    avatarSpeakTimes: [] as number[]
  });
  
  // Function to log performance summary
  const logPerformanceSummary = () => {
    console.log('📊 [PERFORMANCE SUMMARY]');
    console.log(`📊 Total requests: ${performanceMetrics.totalRequests}`);
    console.log(`📊 Average response time: ${performanceMetrics.averageResponseTime.toFixed(2)}ms`);
    console.log(`📊 Average transcription time: ${performanceMetrics.transcriptionTimes.length > 0 ? (performanceMetrics.transcriptionTimes.reduce((a, b) => a + b, 0) / performanceMetrics.transcriptionTimes.length).toFixed(2) : 0}ms`);
    console.log(`📊 Average OpenAI time: ${performanceMetrics.openaiTimes.length > 0 ? (performanceMetrics.openaiTimes.reduce((a, b) => a + b, 0) / performanceMetrics.openaiTimes.length).toFixed(2) : 0}ms`);
    console.log(`📊 Average avatar speak time: ${performanceMetrics.avatarSpeakTimes.length > 0 ? (performanceMetrics.avatarSpeakTimes.reduce((a, b) => a + b, 0) / performanceMetrics.avatarSpeakTimes.length).toFixed(2) : 0}ms`);
  };
  
  // Audio context and gain node for volume control
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const [volumeLevel, setVolumeLevel] = useState<number>(2.0); // Default to 2x volume boost
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
          }, 500); // Reduced from 2000ms to 500ms
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
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Generate 4 witty button prompts (1-3 words each) based on conversation. Return only the 4 button texts, one per line.`
          },
          {
            role: 'user',
            content: `Context: ${conversation.slice(-1).map(msg => msg.content).join(' ')}` // Only use last message for fastest processing
          }
        ],
        max_tokens: 40, // Even more reduced for faster response
        temperature: 0.5 // Lower temperature for more consistent, faster responses
      });
      
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
    // Optimized for faster responses
    timeout: 8000, // Reduced timeout for faster failure detection
    maxRetries: 1, // Reduced retries for faster response
    // Add keep-alive for connection reuse
    fetch: (url, options) => {
      return fetch(url, {
        ...options,
        keepalive: true,
        headers: {
          ...options?.headers,
          'Connection': 'keep-alive'
        }
      });
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
        const silenceTimeout = 500; // Reduced to 1.5 seconds of silence for faster response
        const voiceThreshold = 25; // Lower threshold for more sensitive voice detection

        const checkForVoice = () => {
          analyser.getByteFrequencyData(dataArray);
          const avgVolume = dataArray.reduce((a, b) => a + b) / bufferLength;

          if (avgVolume > voiceThreshold && !isRecording) {
            // Voice detected, start recording
            const recordingStartTime = performance.now();
            console.log('🎤 [DEBUG] Voice detected! Starting recording...');
            console.log(`🎤 [DEBUG] Volume level: ${avgVolume.toFixed(2)}`);
            
            isRecording = true;
            silenceStart = null;
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = [];

            mediaRecorder.current.ondataavailable = (event) => {
              audioChunks.current.push(event.data);
            };

            mediaRecorder.current.onstop = () => {
              const recordingEndTime = performance.now();
              const recordingDuration = recordingEndTime - recordingStartTime;
              console.log(`🎤 [DEBUG] Recording stopped after ${recordingDuration.toFixed(2)}ms`);
              console.log(`🎤 [DEBUG] Audio chunks collected: ${audioChunks.current.length}`);
              
              const audioBlob = new Blob(audioChunks.current, {
                type: 'audio/wav',
              });
              console.log(`🎤 [DEBUG] Audio blob size: ${(audioBlob.size / 1024).toFixed(2)}KB`);
              
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
              const silenceDuration = Date.now() - silenceStart;
              console.log(`🤫 [DEBUG] Silence detected for ${silenceDuration}ms, stopping recording...`);
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

  // Function to handle file upload with interactive voice chat
  const handleFileUpload = async (file: File) => {
    try {
      // Show success message
      toast({
        title: "File uploaded successfully!",
        description: `File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      });

      // Store the uploaded file and set up for interactive analysis
      setUploadedFile(file);
      setAnalysisStep('question');
      
      // Ask what help the user needs first
      const questionPrompt = `I see you've uploaded a ${file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'}. What would you like me to help you with? Please tell me what you need assistance with regarding this ${file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'}.`;
      
      setInput(questionPrompt);
      
    } catch (error: any) {
      console.error('Error processing file:', error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      });
    }
  };

  // Function to reset analysis state
  const resetAnalysisState = () => {
    setUploadedFile(null);
    setAnalysisStep('upload');
    setUserQuestion('');
    setAnalysisContext(null);
  };

  // Function to process file analysis based on user's question
  const processFileAnalysis = async (file: File, userQuestion: string) => {
    try {
      console.log('🎯 [DEBUG] Starting file analysis with user question:', userQuestion);
      
      let aiResponse;

      if (file.type.startsWith('image/')) {
        // Handle images with GPT-4 Vision
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove the data:image/...;base64, prefix
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.readAsDataURL(file);
        });

        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI assistant that analyzes images based on user questions. Provide detailed, accurate, and helpful responses. Be conversational and engaging.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `The user asked: "${userQuestion}". Please analyze this image and provide a detailed response based on their specific question.`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${file.type};base64,${base64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 1000
        });

      } else if (file.type.startsWith('video/')) {
        // Handle videos - extract frame for analysis
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const videoUrl = URL.createObjectURL(file);
        video.src = videoUrl;
        
        // Wait for video to load and extract a frame
        await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            video.currentTime = 1; // Get frame at 1 second
          };
          video.onseeked = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx?.drawImage(video, 0, 0);
            resolve(null);
          };
        });

        // Convert canvas to base64
        const frameBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI assistant that analyzes video frames based on user questions. Provide detailed, accurate, and helpful responses. Be conversational and engaging.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `The user asked: "${userQuestion}". Please analyze this video frame from "${file.name}" and provide a detailed response based on their specific question.`
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
        });

        URL.revokeObjectURL(videoUrl);

      } else if (file.type.startsWith('text/')) {
        // Handle text files
        const fileContent = await file.text();
        const prompt = `The user asked: "${userQuestion}". I've uploaded a text file: ${file.name}. Here's the content:\n\n${fileContent}\n\nPlease analyze this content and provide insights based on their specific question.`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'user', content: prompt }
          ]
        });

      } else {
        // For other file types, provide basic analysis
        const prompt = `The user asked: "${userQuestion}". I've uploaded a file: ${file.name} (${file.type}). Please help me understand what I can do with this file and provide any relevant guidance based on their specific question.`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'user', content: prompt }
          ]
        });
      }
      
      const analysisResult = aiResponse.choices[0].message.content || '';
      
      // Store the analysis context
      setAnalysisContext({
        file,
        userQuestion,
        analysisResult
      });
      
      // Set the analysis result as input for avatar to speak
      setInput(analysisResult);
      setAnalysisStep('complete');
      
      // Update conversation history
      const updatedHistory = [...conversationHistory, { role: 'user', content: userQuestion }];
      const limitedHistory = updatedHistory.slice(-4);
      setConversationHistory(limitedHistory);
      
      const finalHistory = [...limitedHistory, { role: 'assistant', content: analysisResult }];
      setConversationHistory(finalHistory);
      
      // Generate dynamic buttons in background
      generateDynamicButtons(finalHistory).catch(error => {
        console.warn('Dynamic buttons generation failed:', error);
      });
      
    } catch (error: any) {
      console.error('Error processing file analysis:', error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      });
      
      // Reset analysis state on error
      setAnalysisStep('upload');
      setUploadedFile(null);
      setUserQuestion('');
      setAnalysisContext(null);
    }
  };

  // Function to process follow-up questions after analysis
  const processFollowUpQuestion = async (followUpQuestion: string, context: { file: File; userQuestion: string; analysisResult: string }) => {
    try {
      console.log('🎯 [DEBUG] Processing follow-up question:', followUpQuestion);
      
      let aiResponse;

      if (context.file.type.startsWith('image/')) {
        // Handle images with GPT-4 Vision for follow-up
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.readAsDataURL(context.file);
        });

        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI assistant that answers follow-up questions about previously analyzed images. Provide detailed, accurate, and helpful responses. Be conversational and engaging.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Previous analysis context: "${context.analysisResult}". The user now asks: "${followUpQuestion}". Please provide a detailed response based on the image and the previous analysis.`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${context.file.type};base64,${base64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 1000
        });

      } else if (context.file.type.startsWith('video/')) {
        // Handle videos for follow-up
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const videoUrl = URL.createObjectURL(context.file);
        video.src = videoUrl;
        
        await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            video.currentTime = 1;
          };
          video.onseeked = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx?.drawImage(video, 0, 0);
            resolve(null);
          };
        });

        const frameBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI assistant that answers follow-up questions about previously analyzed videos. Provide detailed, accurate, and helpful responses. Be conversational and engaging.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Previous analysis context: "${context.analysisResult}". The user now asks: "${followUpQuestion}". Please provide a detailed response based on the video frame and the previous analysis.`
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
        });

        URL.revokeObjectURL(videoUrl);

      } else {
        // Handle other file types for follow-up
        const prompt = `Previous analysis context: "${context.analysisResult}". The user now asks: "${followUpQuestion}". Please provide a detailed response based on the file "${context.file.name}" and the previous analysis.`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'user', content: prompt }
          ]
        });
      }
      
      const followUpResult = aiResponse.choices[0].message.content || '';
      
      // Update the analysis context with the new result
      setAnalysisContext({
        ...context,
        analysisResult: followUpResult
      });
      
      // Set the follow-up result as input for avatar to speak
      setInput(followUpResult);
      
      // Update conversation history
      const updatedHistory = [...conversationHistory, { role: 'user', content: followUpQuestion }];
      const limitedHistory = updatedHistory.slice(-4);
      setConversationHistory(limitedHistory);
      
      const finalHistory = [...limitedHistory, { role: 'assistant', content: followUpResult }];
      setConversationHistory(finalHistory);
      
      // Generate dynamic buttons in background
      generateDynamicButtons(finalHistory).catch(error => {
        console.warn('Dynamic buttons generation failed:', error);
      });
      
    } catch (error: any) {
      console.error('Error processing follow-up question:', error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      });
    }
  };

  // Function to transcribe the audio to text and then get the respective response of the given prompt
  async function transcribeAudio(audioBlob: Blob) {
    const startTime = performance.now();
    console.log('🎯 [DEBUG] Starting audio transcription process');
    
    try {
      // Convert Blob to File
      const audioFile = new File([audioBlob], 'recording.wav', {
        type: 'audio/wav',
      });

      console.log('🎯 [DEBUG] Audio file created, starting transcription...');
      const transcriptionStartTime = performance.now();

      // Start transcription for faster processing
      const transcriptionResponse = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
      });

      const transcriptionEndTime = performance.now();
      const transcriptionDuration = transcriptionEndTime - transcriptionStartTime;
      console.log(`🎯 [DEBUG] Transcription completed in ${transcriptionDuration.toFixed(2)}ms`);
      console.log('🎯 [DEBUG] Transcription result:', transcriptionResponse.text);
      
      // Track performance metrics
      setPerformanceMetrics(prev => {
        const newTranscriptionTimes = [...prev.transcriptionTimes, transcriptionDuration];
        console.log(`🎯 [DEBUG] Updated transcription metrics: ${transcriptionDuration.toFixed(2)}ms`);
        
        return {
          ...prev,
          transcriptionTimes: newTranscriptionTimes,
          totalRequests: prev.totalRequests + 1
        };
      });

      const transcription = transcriptionResponse.text;
      
      // Handle interactive analysis flow
      if (analysisStep === 'question' && uploadedFile) {
        console.log('🎯 [DEBUG] Processing user question for file analysis');
        setUserQuestion(transcription);
        setAnalysisStep('analysis');
        
        // Process the analysis based on user's question
        await processFileAnalysis(uploadedFile, transcription);
        return;
      }
      
      // Handle follow-up questions after analysis is complete
      if (analysisStep === 'complete' && analysisContext) {
        console.log('🎯 [DEBUG] Processing follow-up question for completed analysis');
        
        // Process follow-up question with context
        await processFollowUpQuestion(transcription, analysisContext);
        return;
      }
      
      // Check preloaded responses first for instant response
      const preloadCheckStart = performance.now();
      const normalizedInput = transcription.toLowerCase().trim();
      const preloadedResponse = preloadedResponses.current.get(normalizedInput);
      const preloadCheckEnd = performance.now();
      
      console.log(`🎯 [DEBUG] Preload check completed in ${(preloadCheckEnd - preloadCheckStart).toFixed(2)}ms`);
      
      if (preloadedResponse) {
        const preloadTotalTime = performance.now() - startTime;
        console.log(`⚡ [DEBUG] Using preloaded response! Total time: ${preloadTotalTime.toFixed(2)}ms`);
        console.log('⚡ [DEBUG] Preloaded response:', preloadedResponse);
        
        setInput(preloadedResponse);
        
        const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
        const limitedHistory = updatedHistory.slice(-4);
        setConversationHistory(limitedHistory);
        
        const finalHistory = [...limitedHistory, { role: 'assistant', content: preloadedResponse }];
        setConversationHistory(finalHistory);
        
        // Generate dynamic buttons in background
        generateDynamicButtons(finalHistory).catch(error => {
          console.warn('Dynamic buttons generation failed:', error);
        });
        return;
      }
      
      // Check cache second for faster response
      const cacheCheckStart = performance.now();
      const cacheKey = normalizedInput;
      const cachedResponse = responseCache.current.get(cacheKey);
      const cacheCheckEnd = performance.now();
      
      console.log(`🎯 [DEBUG] Cache check completed in ${(cacheCheckEnd - cacheCheckStart).toFixed(2)}ms`);
      
      if (cachedResponse) {
        const cacheTotalTime = performance.now() - startTime;
        console.log(`🚀 [DEBUG] Using cached response! Total time: ${cacheTotalTime.toFixed(2)}ms`);
        console.log('🚀 [DEBUG] Cached response:', cachedResponse);
        
        setInput(cachedResponse);
        
        // Update conversation history
        const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
        const limitedHistory = updatedHistory.slice(-4);
        setConversationHistory(limitedHistory);
        
        const finalHistory = [...limitedHistory, { role: 'assistant', content: cachedResponse }];
        setConversationHistory(finalHistory);
        
        // Generate dynamic buttons in background
        generateDynamicButtons(finalHistory).catch(error => {
          console.warn('Dynamic buttons generation failed:', error);
        });
        return;
      }
      
      // Reset analysis state if user starts a new conversation
      if (analysisStep !== 'upload') {
        resetAnalysisState();
      }
      
      // Update conversation history with limited size for faster processing
      const historyUpdateStart = performance.now();
      const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
      // Keep only last 4 messages (2 exchanges) to reduce API payload
      const limitedHistory = updatedHistory.slice(-4);
      setConversationHistory(limitedHistory);
      const historyUpdateEnd = performance.now();
      
      console.log(`🎯 [DEBUG] History update completed in ${(historyUpdateEnd - historyUpdateStart).toFixed(2)}ms`);
      
      // Get a more specific response based on actual transcription with streaming
      console.log('🎯 [DEBUG] Starting OpenAI API call...');
      const openaiStartTime = performance.now();
      
      const specificResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: `You are a clever, witty AI assistant. Keep responses under 10 words, be engaging and conversational.`
          },
          { role: 'user', content: transcription || '' }
        ],
        max_tokens: 15, // Much more reduced for faster response
        temperature: 0.5, // Lower for more consistent, faster responses
        stream: false // Keep false for now, but we'll optimize the response handling
      });
      
      const openaiEndTime = performance.now();
      const openaiDuration = openaiEndTime - openaiStartTime;
      console.log(`🎯 [DEBUG] OpenAI API call completed in ${openaiDuration.toFixed(2)}ms`);
      
      // Track performance metrics
      setPerformanceMetrics(prev => {
        const newOpenaiTimes = [...prev.openaiTimes, openaiDuration];
        const newAverage = newOpenaiTimes.length > 0 ? 
          newOpenaiTimes.reduce((a, b) => a + b, 0) / newOpenaiTimes.length : 0;
        
        console.log(`🎯 [DEBUG] Updated OpenAI metrics: ${openaiDuration.toFixed(2)}ms, avg: ${newAverage.toFixed(2)}ms`);
        
        return {
          ...prev,
          openaiTimes: newOpenaiTimes
        };
      });
      
      const aiMessage = specificResponse.choices[0].message.content || '';
      console.log('🎯 [DEBUG] AI response:', aiMessage);
      
      // Cache the response for future use
      const cacheUpdateStart = performance.now();
      responseCache.current.set(cacheKey, aiMessage);
      
      // Limit cache size to prevent memory issues
      if (responseCache.current.size > 50) {
        const firstKey = responseCache.current.keys().next().value;
        if (firstKey) {
          responseCache.current.delete(firstKey);
        }
      }
      const cacheUpdateEnd = performance.now();
      
      console.log(`🎯 [DEBUG] Cache update completed in ${(cacheUpdateEnd - cacheUpdateStart).toFixed(2)}ms`);
      
      setInput(aiMessage);
      
      // Update conversation history with AI response
      const finalHistory = [...limitedHistory, { role: 'assistant', content: aiMessage }];
      setConversationHistory(finalHistory);
      
      // Generate dynamic buttons in background (non-blocking)
      generateDynamicButtons(finalHistory).catch(error => {
        console.warn('Dynamic buttons generation failed:', error);
      });
      
      const totalTime = performance.now() - startTime;
      console.log(`🎯 [DEBUG] Total processing time: ${totalTime.toFixed(2)}ms`);
      console.log(`🎯 [DEBUG] Breakdown: Transcription: ${transcriptionDuration.toFixed(2)}ms, OpenAI: ${openaiDuration.toFixed(2)}ms`);
      
      // Update average response time
      setPerformanceMetrics(prev => {
        const newAverage = (prev.averageResponseTime * (prev.totalRequests - 1) + totalTime) / prev.totalRequests;
        return {
          ...prev,
          averageResponseTime: newAverage
        };
      });
      
      // Log performance summary every 5 requests
      if ((performanceMetrics.totalRequests + 1) % 5 === 0) {
        logPerformanceSummary();
      }
    } catch (error: any) {
      console.error('Error transcribing audio:', error);
      toast({
        variant: "destructive",
        title: "Well, that was unexpected! 🤔",
        description: `Sometimes the most interesting discoveries come from the most unexpected errors: ${error.message}. Let's try that again with a fresh perspective!`,
      })
    }
  }

  // useEffect getting triggered when the input state is updated, basically make the avatar to talk
  useEffect(() => {
    function speak() {
      if (!input || !avatar.current || !data?.sessionId) return;
      
      const speakStartTime = performance.now();
      console.log('🎯 [DEBUG] Starting avatar speak process');
      console.log('🎯 [DEBUG] Input text:', input);
      
      try {
        // Optimize text length for faster avatar response
        // Much shorter text = much faster TTS processing
        // Break long responses into chunks for faster processing
        let optimizedText = input;
        if (input.length > 60) {
          // Find the last sentence or word boundary before 60 characters
          const truncated = input.substring(0, 60);
          const lastSentence = truncated.lastIndexOf('.');
          const lastWord = truncated.lastIndexOf(' ');
          
          if (lastSentence > 30) {
            optimizedText = input.substring(0, lastSentence + 1);
          } else if (lastWord > 20) {
            optimizedText = input.substring(0, lastWord) + "...";
          } else {
            optimizedText = truncated + "...";
          }
        }
        
        console.log(`🎯 [DEBUG] Text length: ${input.length} chars, optimized: ${optimizedText.length} chars`);
        
        // Start speaking immediately without waiting for completion
        const speakPromise = avatar.current.speak({ 
          taskRequest: { 
            text: optimizedText, 
            sessionId: data.sessionId! 
          } 
        });
        
        const speakInitTime = performance.now();
        console.log(`🎯 [DEBUG] Avatar speak initiated in ${(speakInitTime - speakStartTime).toFixed(2)}ms`);
        
        // Don't wait for completion - let it run in background
        // This reduces perceived response time significantly
        speakPromise.then(() => {
          const speakCompleteTime = performance.now();
          const speakDuration = speakCompleteTime - speakStartTime;
          console.log(`🎯 [DEBUG] Avatar speak completed in ${speakDuration.toFixed(2)}ms`);
          
          // Track avatar speak time
          setPerformanceMetrics(prev => {
            const newAvatarSpeakTimes = [...prev.avatarSpeakTimes, speakDuration];
            console.log(`🎯 [DEBUG] Updated avatar speak metrics: ${speakDuration.toFixed(2)}ms`);
            
            return {
              ...prev,
              avatarSpeakTimes: newAvatarSpeakTimes
            };
          });
        }).catch((err: any) => {
          const speakErrorTime = performance.now();
          const speakErrorDuration = speakErrorTime - speakStartTime;
          console.error(`🎯 [DEBUG] Avatar speak error after ${speakErrorDuration.toFixed(2)}ms:`, err);
        });
        
        // Track initiation time (not completion time) for better UX
        const initiationTime = speakInitTime - speakStartTime;
        setPerformanceMetrics(prev => {
          const newAvatarSpeakTimes = [...prev.avatarSpeakTimes, initiationTime];
          console.log(`🎯 [DEBUG] Updated avatar initiation metrics: ${initiationTime.toFixed(2)}ms`);
          
          return {
            ...prev,
            avatarSpeakTimes: newAvatarSpeakTimes
          };
        });
        
        console.log(`🎯 [DEBUG] Avatar speak started successfully in ${initiationTime.toFixed(2)}ms - not waiting for completion`);
        
      } catch (err: any) {
        const speakSetupErrorTime = performance.now();
        const speakSetupErrorDuration = speakSetupErrorTime - speakStartTime;
        console.error(`🎯 [DEBUG] Avatar speak setup error after ${speakSetupErrorDuration.toFixed(2)}ms:`, err);
      }
    }

    // Execute immediately without async/await overhead
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
    
    // Pre-warm avatar for faster first response
    setTimeout(() => {
      preWarmAvatarResponse();
    }, 1000);
    
    // Initialize UI components immediately
    setDynamicButtons([
      "Mind-Bending Mysteries",
      "Money Magic & Mayhem", 
      "Love & Laughter Therapy",
      "Life's Comedy Coach"
    ]);
    
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
      
      // Start periodic analysis every 8 seconds (less frequent to avoid overwhelming)
      analysisIntervalRef.current = setInterval(() => {
        if (cameraVideoRef.current && !isAnalyzing && !isAvatarSpeaking) {
          handleMotionStopped(); // Trigger analysis
        }
      }, 8000);
      
      toast({
        title: "📸 Camera Activated!",
        description: "I'm now watching and ready to analyze what you're up to! 😄",
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
    
    // Analyze with OpenAI Vision using streaming for faster response
    const response = await openai.chat.completions.create({
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
      max_tokens: 200,
      stream: true // Enable streaming for faster response
    });
    
    let fullAnalysis = '';
    let hasStartedSpeaking = false;
    
    // Process streaming response for immediate avatar speech
    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullAnalysis += content;
        
        // Start speaking as soon as we have enough content (minimum 15 characters)
        if (fullAnalysis.length >= 15 && !hasStartedSpeaking && !isProcessingQueueRef.current) {
          const partialAnalysis = fullAnalysis.trim();
          if (partialAnalysis) {
            analysisQueueRef.current.push(partialAnalysis);
            processAnalysisQueue();
            hasStartedSpeaking = true;
            console.log('🚀 Starting speech with partial content:', partialAnalysis);
          }
        }
      }
    }
    
    // If we didn't start speaking with partial content, use the full analysis
    if (!hasStartedSpeaking && fullAnalysis.trim()) {
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

// When the user selects the pre-defined prompts, this useEffect will get triggered
useEffect(() => {
  if (selectedPrompt) {
    const buttonClickStartTime = performance.now();
    console.log('🎯 [DEBUG] Button clicked, starting OpenAI API call');
    console.log('🎯 [DEBUG] Selected prompt:', selectedPrompt);
    
    const openaiStartTime = performance.now();
    
    openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'You are a witty AI assistant. Keep responses under 10 words, be engaging and conversational.'
          },
          { role: 'user', content: selectedPrompt }
        ],
        max_tokens: 15, // Much more reduced for faster response
      temperature: 0.6 // Lower for more consistent, faster responses
    }).then(aiResponse => {
      const openaiEndTime = performance.now();
      const openaiDuration = openaiEndTime - openaiStartTime;
      const totalDuration = openaiEndTime - buttonClickStartTime;
      
      console.log(`🎯 [DEBUG] OpenAI API call completed in ${openaiDuration.toFixed(2)}ms`);
      console.log(`🎯 [DEBUG] Total button response time: ${totalDuration.toFixed(2)}ms`);
      console.log('🎯 [DEBUG] AI response:', aiResponse.choices[0].message.content);
      
      // Track OpenAI timing for button clicks
      setPerformanceMetrics(prev => {
        const newOpenaiTimes = [...prev.openaiTimes, openaiDuration];
        console.log(`🎯 [DEBUG] Button OpenAI timing: ${openaiDuration.toFixed(2)}ms`);
        return {
          ...prev,
          openaiTimes: newOpenaiTimes
        };
      });
      
      setInput(aiResponse.choices[0].message.content || '');
    }).catch(error => {
      const errorTime = performance.now();
      const errorDuration = errorTime - buttonClickStartTime;
      console.error(`🎯 [DEBUG] Button click error after ${errorDuration.toFixed(2)}ms:`, error);
      
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      })
    })
  }
}, [selectedPrompt])


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
    <div className="h-screen w-screen relative overflow-hidden">
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
              {loadingProgress < 50 ? "Preparing jokes and witty comebacks! " : 
               loadingProgress < 80 ? "Setting up the stage for comedy! 🎪" :
               "Almost ready to entertain!"}
            </div>
            
            <div className="text-xs mt-2 opacity-50">
              {loadingProgress}% complete
            </div>
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
              />
            </Suspense>
            <Suspense fallback={<div className="h-16 bg-gray-200 animate-pulse rounded-full"></div>}>
              <MicButton
                isSpeaking={isSpeaking}
                onClick={isSpeaking ? handleStopSpeaking : handleStartSpeaking}
                stopAvatar={stop}
                grab={grab}
                avatarStartLoading={startAvatarLoading}
                avatarStopLoading={stopAvatarLoading}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  </>
);
}

export default App;
