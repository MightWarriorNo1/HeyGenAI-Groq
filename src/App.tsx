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
  const [, setData] = useState<NewSessionData>();
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);
  
  // Ref to store  v  sessionId for immediate access in voice detection
  const sessionIdRef = useRef<string | null>(null);

  const [startAvatarLoading, setStartAvatarLoading] = useState<boolean>(false);
  const [isSessionStarted, setIsSessionStarted] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  
  // Camera states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState<boolean>(false);
  const [isUserTalking, setIsUserTalking] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  
  // Ref to track actual speaking state to prevent race conditions
  const isAvatarSpeakingRef = useRef<boolean>(false);
  const speakingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioDetectionRef = useRef<boolean>(false);
  
  // Ref to track current camera state for voice detection
  const cameraStateRef = useRef<boolean>(false);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  
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

  // Function to detect when avatar actually stops speaking
  const detectAvatarAudioStop = () => {
    if (!mediaStream.current || !isAvatarSpeakingRef.current) return;
    
    console.log('🎭 Starting audio detection for avatar speech');
    audioDetectionRef.current = true;
    
    const checkAudioLevel = () => {
      if (!audioDetectionRef.current || !isAvatarSpeakingRef.current) return;
      
      try {
        // Get the video element that contains the avatar audio
        const video = mediaStream.current;
        if (video) {
          // Check multiple conditions to determine if avatar stopped speaking
          const isPlaying = !video.paused && !video.ended && video.readyState > 2;
          const isMuted = video.muted;
          const volume = video.volume;
          
          console.log('🎭 Audio detection check:', {
            isPlaying,
            isMuted,
            volume,
            readyState: video.readyState,
            paused: video.paused,
            ended: video.ended
          });
          
          // Avatar stopped speaking if:
          // 1. Video is not playing, OR
          // 2. Video is muted, OR  
          // 3. Volume is 0, OR
          // 4. Video has ended
          if (!isPlaying || isMuted || volume === 0 || video.ended) {
            console.log('🎭 Audio detection: Avatar stopped speaking', {
              reason: !isPlaying ? 'video not playing' : 
                      isMuted ? 'video muted' : 
                      volume === 0 ? 'volume is 0' : 'video ended'
            });
            audioDetectionRef.current = false;
            isAvatarSpeakingRef.current = false;
            setIsAvatarSpeaking(false);
            emitEvent('AVATAR_STOP_TALKING');
            return;
          }
        }
        
        // Continue checking every 500ms
        setTimeout(checkAudioLevel, 500);
      } catch (error) {
        console.error('🎭 Audio detection error:', error);
        // Fallback to timer-based approach
        audioDetectionRef.current = false;
        console.log('🎭 Audio detection failed, falling back to timer-based approach');
      }
    };
    
    // Start checking after a short delay
    setTimeout(checkAudioLevel, 1000);
  };

  // Function to manually reset avatar speaking state (for debugging and recovery)
  const resetAvatarSpeakingState = () => {
    console.log('🎭 Manually resetting avatar speaking state');
    audioDetectionRef.current = false;
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    isAvatarSpeakingRef.current = false;
    setIsAvatarSpeaking(false);
    emitEvent('AVATAR_STOP_TALKING');
  };

  // Avatar control methods
  const startAvatarSpeaking = async (text: string) => {
    if (!avatar.current || !sessionIdRef.current) {
      console.log('🎭 Cannot start avatar speech - missing requirements:', {
        hasAvatar: !!avatar.current,
        hasSessionId: !!sessionIdRef.current,
        sessionId: sessionIdRef.current
      });
      return;
    }
    
    try {
      console.log('🎭 Starting avatar speech:', text);
      console.log('🎭 Using session ID:', sessionIdRef.current);
      
      // Set speaking state immediately when speech starts
      isAvatarSpeakingRef.current = true;
      setIsAvatarSpeaking(true);
      console.log('🎭 Avatar speaking state set to true immediately');
      
      // Restore audio if it was muted
      if (mediaStream.current) {
        mediaStream.current.muted = false;
        mediaStream.current.volume = 1.0;
        console.log('🎭 Avatar audio restored');
      }
      
      // Start the speech
      const speakPromise = avatar.current.speak({ 
        taskRequest: { 
          text: text, 
          sessionId: sessionIdRef.current! 
        } 
      });
      
      // Calculate minimum speaking duration based on text length
      const wordsPerSecond = 1.5; // Much slower speaking speed for more realistic timing
      const wordCount = text.split(' ').length;
      const estimatedDuration = Math.max(20000, (wordCount / wordsPerSecond) * 1000); // At least 20 seconds
      
      console.log(`🎭 Estimated speaking duration: ${estimatedDuration}ms for ${wordCount} words`);
      
      // Clear any existing timer
      if (speakingTimerRef.current) {
        clearTimeout(speakingTimerRef.current);
      }
      
      // Set up a timer that will disable speaking after the estimated duration (fallback)
      speakingTimerRef.current = setTimeout(() => {
        console.log('🎭 Avatar speaking timer expired - setting to false (fallback)');
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        speakingTimerRef.current = null;
        audioDetectionRef.current = false;
        emitEvent('AVATAR_STOP_TALKING');
      }, estimatedDuration);
      
      // Start audio detection
      detectAvatarAudioStop();
      
      // Handle speech completion - but don't immediately stop, let audio detection handle it
      speakPromise.then(() => {
        console.log('🎭 Avatar speech promise resolved - audio detection will handle actual stop');
        // Don't set to false here - let audio detection handle it
      }).catch((err: any) => {
        console.error('Avatar speak error:', err);
        if (speakingTimerRef.current) {
          clearTimeout(speakingTimerRef.current);
          speakingTimerRef.current = null;
        }
        audioDetectionRef.current = false;
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        emitEvent('AVATAR_STOP_TALKING');
      });
      
      // Add a backup mechanism to ensure state is cleared even if audio detection fails
      // This will run after the estimated duration + 5 seconds as a safety net
      setTimeout(() => {
        if (isAvatarSpeakingRef.current) {
          console.log('🎭 Backup mechanism: Force clearing speaking state after timeout');
          audioDetectionRef.current = false;
          isAvatarSpeakingRef.current = false;
          setIsAvatarSpeaking(false);
          emitEvent('AVATAR_STOP_TALKING');
        }
      }, estimatedDuration + 5000); // 5 seconds after estimated duration
      
      return speakPromise;
    } catch (err: any) {
      console.error('Avatar speak setup error:', err);
      isAvatarSpeakingRef.current = false;
      setIsAvatarSpeaking(false);
      emitEvent('AVATAR_STOP_TALKING');
    }
  };

  const stopAvatarSpeaking = async () => {
    if (isAvatarSpeakingRef.current) {
      console.log('🎭 Manually stopping avatar speech');
      
      try {
        // Use the proper HeyGen API method to stop avatar
        if (avatar.current && typeof avatar.current.stopAvatar === 'function' && sessionIdRef.current) {
          await avatar.current.stopAvatar({ 
            stopSessionRequest: { 
              sessionId: sessionIdRef.current 
            } 
          });
          console.log('🎭 Called avatar.stopAvatar() - avatar should stop speaking');
        } else {
          console.log('🎭 stopAvatar method not available or sessionId missing, using audio muting workaround');
          // Fallback to muting if method not available
          if (mediaStream.current) {
            mediaStream.current.muted = true;
            mediaStream.current.volume = 0;
            console.log('🎭 Avatar audio muted as workaround');
          }
        }
      } catch (error) {
        console.error('🎭 Error stopping avatar:', error);
        // Fallback to muting if API call fails
        if (mediaStream.current) {
          mediaStream.current.muted = true;
          mediaStream.current.volume = 0;
          console.log('🎭 Avatar audio muted as fallback');
        }
      }
      
      // Stop audio detection
      audioDetectionRef.current = false;
      
      // Clear timer and update state
      if (speakingTimerRef.current) {
        clearTimeout(speakingTimerRef.current);
        speakingTimerRef.current = null;
      }
      isAvatarSpeakingRef.current = false;
      setIsAvatarSpeaking(false);
      emitEvent('AVATAR_STOP_TALKING');
    }
  };

  const interruptAvatarSpeaking = async () => {
    console.log('🎭 interruptAvatarSpeaking called:', {
      isAvatarSpeakingRef: isAvatarSpeakingRef.current,
      isAvatarSpeaking,
      hasAvatar: !!avatar.current,
      hasSessionId: !!sessionIdRef.current
    });
    
    if (isAvatarSpeakingRef.current) {
      console.log('🎭 Interrupting avatar speech', {
        hasAvatar: !!avatar.current,
        hasSessionId: !!sessionIdRef.current,
        sessionId: sessionIdRef.current,
        hasInterruptMethod: !!(avatar.current && typeof avatar.current.interrupt === 'function'),
        hasStopAvatarMethod: !!(avatar.current && typeof avatar.current.stopAvatar === 'function')
      });
      
      try {
        // Use the proper HeyGen API method to interrupt avatar
        if (avatar.current && typeof avatar.current.interrupt === 'function' && sessionIdRef.current) {
          await avatar.current.interrupt({ 
            interruptRequest: { 
              sessionId: sessionIdRef.current 
            } 
          });
          console.log('🎭 Called avatar.interrupt() - avatar should stop speaking');
        } else if (avatar.current && typeof avatar.current.stopAvatar === 'function' && sessionIdRef.current) {
          // Fallback to stopAvatar if interrupt not available
          await avatar.current.stopAvatar({ 
            stopSessionRequest: { 
              sessionId: sessionIdRef.current 
            } 
          });
          console.log('🎭 Called avatar.stopAvatar() as fallback');
        } else {
          console.log('🎭 Interrupt/stopAvatar methods not available or sessionId missing, using audio muting workaround');
          // Fallback to muting if methods not available
          if (mediaStream.current) {
            mediaStream.current.muted = true;
            mediaStream.current.volume = 0;
            console.log('🎭 Avatar audio muted as workaround');
          }
          
          // Stop audio detection and clear state for fallback case
          audioDetectionRef.current = false;
          if (speakingTimerRef.current) {
            clearTimeout(speakingTimerRef.current);
            speakingTimerRef.current = null;
          }
          isAvatarSpeakingRef.current = false;
          setIsAvatarSpeaking(false);
          emitEvent('AVATAR_STOP_TALKING');
        }
      } catch (error) {
        console.error('🎭 Error interrupting avatar:', error);
        // Fallback to muting if API call fails
        if (mediaStream.current) {
          mediaStream.current.muted = true;
          mediaStream.current.volume = 0;
          console.log('🎭 Avatar audio muted as fallback');
        }
        
        // Stop audio detection and clear state for error case
        audioDetectionRef.current = false;
        if (speakingTimerRef.current) {
          clearTimeout(speakingTimerRef.current);
          speakingTimerRef.current = null;
        }
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        emitEvent('AVATAR_STOP_TALKING');
      }
      
      // Only do state cleanup if we haven't already done it in fallback/error cases
      if (isAvatarSpeakingRef.current) {
        // Use the centralized reset function for consistency
        resetAvatarSpeakingState();
      }
    }
  };

  // Event system for avatar and user talking states
  const emitEvent = (eventType: string, data?: any) => {
    console.log(`🎭 Event: ${eventType}`, data);
    
    switch (eventType) {
      case 'USER_START':
        console.log('🎭 USER_START event triggered:', {
          isAvatarSpeaking: isAvatarSpeakingRef.current,
          isUserTalking,
          data
        });
        setIsUserTalking(true);
        // Interrupt avatar if it's speaking
        if (isAvatarSpeakingRef.current) {
          console.log('🎭 USER_START: Interrupting avatar to let user speak');
          interruptAvatarSpeaking();
        } else {
          console.log('🎭 USER_START: Avatar not speaking, no interruption needed');
        }
        break;
        
      case 'AVATAR_STOP_TALKING':
        console.log('🎭 AVATAR_STOP_TALKING: Avatar finished speaking');
        // Don't set state here as it's already handled in the promise handlers
        break;
        
      case 'USER_STOP':
        setIsUserTalking(false);
        console.log('🎭 USER_STOP: User finished speaking');
        break;
    }
  };
  
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
    if (avatar.current && sessionIdRef.current && !preWarmAvatar.current) {
      try {
        // Send a minimal test message to warm up the avatar
        // await avatar.current.speak({ 
        //   taskRequest: { 
        //     text: "Ready", 
        //     sessionId: sessionIdRef.current! 
        //   } 
        // });
        preWarmAvatar.current = true;
        console.log('🔥 Avatar pre-warmed for faster responses');
      } catch (error) {
        console.log('Pre-warm failed, will use normal flow:', error);
      }
    }
  };

  // Function to process analysis queue with reduced latency
  const processAnalysisQueue = async () => {
    console.log('🎭 Processing queue - current state:', {
      isProcessing: isProcessingQueueRef.current,
      queueLength: analysisQueueRef.current.length,
      hasAvatar: !!avatar.current,
      hasSessionId: !!sessionIdRef.current,
      sessionId: sessionIdRef.current,
      isAvatarSpeaking: isAvatarSpeakingRef.current
    });
    
    if (isProcessingQueueRef.current || analysisQueueRef.current.length === 0) {
      console.log('🎭 Queue processing skipped:', {
        isProcessing: isProcessingQueueRef.current,
        queueLength: analysisQueueRef.current.length
      });
      return;
    }
    
    isProcessingQueueRef.current = true;
    const analysis = analysisQueueRef.current.shift();
    
    console.log('🎭 Processing analysis item:', analysis);
    
    if (analysis && avatar.current && sessionIdRef.current) {
      try {
        // Use the new control method
        console.log('🎭 Starting avatar speech for analysis...');
        await startAvatarSpeaking(analysis);
        
        // Wait for speech to complete before processing next item
        setTimeout(() => {
          console.log('🎭 Analysis speech completed, checking for more items...');
          isProcessingQueueRef.current = false;
          // Process next item immediately if available
          if (analysisQueueRef.current.length > 0) {
            console.log('🎭 More items in queue, processing next...');
            processAnalysisQueue();
          }
        }, 2000); // Wait 2 seconds for speech to complete
        
      } catch (speakError) {
        console.error('Error making avatar speak:', speakError);
        isProcessingQueueRef.current = false;
      }
    } else {
      console.log('🎭 Cannot process analysis - missing requirements:', {
        hasAnalysis: !!analysis,
        hasAvatar: !!avatar.current,
        hasSessionId: !!sessionIdRef.current,
        sessionId: sessionIdRef.current
      });
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


  // Function to get current camera state dynamically
  const getCurrentCameraState = () => {
    // Access the current camera stream from the ref (always current)
    const currentStream = cameraStreamRef.current;
    return {
      isActive: cameraStateRef.current,
      stream: currentStream,
      hasStream: !!currentStream,
      streamTracks: currentStream?.getTracks().length || 0,
      videoTracks: currentStream?.getVideoTracks().length || 0,
      audioTracks: currentStream?.getAudioTracks().length || 0
    };
  };

  // Function to start continuous listening for voice input
  const startContinuousListening = () => {
    // Try to use camera stream audio if available, otherwise get new audio stream
    const getAudioStream = async () => {
      const currentState = getCurrentCameraState();
      if (currentState.stream && currentState.audioTracks > 0) {
        console.log('🎤 Using camera stream audio for voice detection');
        return currentState.stream;
      } else {
        console.log('🎤 Getting separate audio stream for voice detection');
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    };

    getAudioStream()
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
        // Dynamic voice threshold based on camera state
          const getVoiceThreshold = () => {
            const currentCameraState = cameraStateRef.current;
            const threshold = currentCameraState ? 20 : 30;
            // console.log('🎤 Voice threshold check:', { currentCameraState, threshold });
            return threshold;
          };

        const checkForVoice = () => {
          analyser.getByteFrequencyData(dataArray);
          const avgVolume = dataArray.reduce((a, b) => a + b) / bufferLength;

          const currentThreshold = getVoiceThreshold();
          
          // Add more detailed logging for debugging
          if (avgVolume > currentThreshold * 0.5) { // Log when approaching threshold
            console.log('🎤 Voice activity detected:', {isCameraActive: cameraStateRef.current, avgVolume, threshold: currentThreshold, isRecording, cameraMode: cameraStateRef.current });
          }

          // Check if user is speaking (voice detected)
          if (avgVolume > currentThreshold) {
            // ALWAYS interrupt avatar if it's speaking, regardless of recording state
            if (isAvatarSpeakingRef.current) {
              console.log('🎤 User started speaking while avatar is talking - interrupting avatar!', { 
                avgVolume, 
                threshold: currentThreshold,
                isAvatarSpeaking: isAvatarSpeakingRef.current,
                isRecording,
                hasAvatar: !!avatar.current,
                hasSessionId: !!sessionIdRef.current,
                sessionId: sessionIdRef.current
              });
              
              // Emit USER_START event to interrupt avatar
              emitEvent('USER_START', { avgVolume, threshold: currentThreshold });
            }
            
            if (!isRecording) {
              // Voice detected, start recording
              console.log('🎤 Someone is trying to talk to me! Let me listen...', { 
                avgVolume, 
                threshold: currentThreshold,
                hasMediaContext,
                mediaFileName 
              });
              
              // Emit USER_START event
              emitEvent('USER_START', { avgVolume, threshold: currentThreshold });
              
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
          }
          } else if (avgVolume < currentThreshold && isRecording) {
            // Voice stopped, check for silence
            if (!silenceStart) silenceStart = Date.now();

            if (Date.now() - silenceStart >= silenceTimeout) {
              console.log('🤫 Ah, the silence! Let me process what you said...', {
                silenceDuration: Date.now() - silenceStart,
                chunksCount: audioChunks.current.length
              });
              
              // Emit USER_STOP event
              emitEvent('USER_STOP', {
                silenceDuration: Date.now() - silenceStart,
                chunksCount: audioChunks.current.length
              });
              
              if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
                mediaRecorder.current.stop();
              }
              isRecording = false;
              silenceStart = null;
            }
          } else if (avgVolume > currentThreshold && isRecording) {
            // Still speaking, reset silence timer
            silenceStart = null;
            
            // ALWAYS interrupt avatar if it's speaking while user continues talking
            if (isAvatarSpeakingRef.current) {
              console.log('🎤 User continues speaking while avatar is talking - interrupting avatar!', { 
                avgVolume, 
                threshold: currentThreshold,
                isAvatarSpeaking: isAvatarSpeakingRef.current,
                isRecording,
                hasAvatar: !!avatar.current,
                hasSessionId: !!sessionIdRef.current,
                sessionId: sessionIdRef.current
              });
              
              // Emit USER_START event to interrupt avatar
              emitEvent('USER_START', { avgVolume, threshold: currentThreshold });
            }
          }

          // Continue monitoring
          requestAnimationFrame(checkForVoice);
        };

        checkForVoice();
      })
      .catch((error) => {
        console.error('Error accessing microphone:', error);
        // If we can't get audio stream, don't affect camera state
        console.log('🎤 Voice detection failed, but camera should remain active');
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
            max_tokens: 100
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
            max_tokens: 100
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
        
        const prompt = `I've uploaded a text file: ${file.name}. Here's the content:\n\n${fileContent}\n\nPlease analyze this content and provide insights or help with it.`;
        
        aiResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o', // Use gpt-4o for better performance
            messages: [
              { role: 'user', content: prompt }
            ],
            max_tokens: 100
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
            max_tokens: 100
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

      console.log("INPUT", input);
      
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
        isCameraActive: cameraStateRef.current, 
        hasCameraRef: !!cameraVideoRef.current 
      });

      // If user is asking about vision, handle accordingly
      if (isVisionRequest) {
        console.log('👁️ Vision request detected! Checking camera state...', {
          transcription,
          isCameraActive: cameraStateRef.current,
          hasCameraStream: !!cameraStream,
          hasCameraRef: !!cameraVideoRef.current,
          cameraStateRef: cameraStateRef.current,
          cameraVideoReady: cameraVideoRef.current ? {
            videoWidth: cameraVideoRef.current.videoWidth,
            videoHeight: cameraVideoRef.current.videoHeight,
            readyState: cameraVideoRef.current.readyState
          } : null
        });
        
        // Get current camera state dynamically
        const currentCameraState = getCurrentCameraState();
        
        if (currentCameraState.isActive && currentCameraState.hasStream) {
          console.log('👁️ Camera is active and has stream! Proceeding with vision analysis...');
          console.log('👁️ Camera state details:', currentCameraState);
          
          // Add a small delay to ensure camera is fully ready
          setTimeout(() => {
            handleVisionAnalysis(transcription);
          }, 500);
          
          return; // Don't process as regular conversation
        } else {
          // Camera not active but user asking about vision
          console.log('👁️ Camera not ready for vision analysis:', {
            isCameraActive: currentCameraState.isActive,
            hasCameraStream: currentCameraState.hasStream,
            hasCameraRef: !!cameraVideoRef.current,
            cameraStateDetails: currentCameraState
          });
          const visionResponse = "I can't see anything right now because the camera isn't active. Please click the camera button to turn on the camera, and then I'll be able to see and describe what's in front of you!";
          setInput(visionResponse);
          console.log("INPUT", input);
          return; // Don't process as regular conversation
        }
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
        console.log("INPUT", input);
        
        // Update conversation history
        const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
        setConversationHistory(updatedHistory);
        
        const finalHistory = [...updatedHistory, { role: 'assistant', content: cachedResponse }];
        setConversationHistory(finalHistory);
        return;
      }
      
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
      
      try {
        const specificResponse = await createApiCall(
          () => openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 100, // Reduced for faster response
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
        console.log("INPUT", input);
        
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
        console.log("INPUT", input);
      }
    }
  }

  // useEffect getting triggered when the input state is updated, basically make the avatar to talk
  useEffect(() => {
    async function speak() {
      if (!input || !avatar.current || !sessionIdRef.current) return;
      
      // Use the new control method
      await startAvatarSpeaking(input);
    }

    speak();
  }, [input]);


  // Debug camera state changes and update ref for voice detection
  useEffect(() => {
    console.log('📹 Camera state changed:', {
      isCameraActive,
      hasCameraStream: !!cameraStream,
      hasCameraRef: !!cameraVideoRef.current,
      cameraVideoDimensions: cameraVideoRef.current ? {
        videoWidth: cameraVideoRef.current.videoWidth,
        videoHeight: cameraVideoRef.current.videoHeight,
        readyState: cameraVideoRef.current.readyState
      } : null
    });
    
    // Update the refs for voice detection
    const previousCameraState = cameraStateRef.current;
    cameraStateRef.current = isCameraActive;
    cameraStreamRef.current = cameraStream;
    console.log('📹 Updated camera state ref:', { 
      previous: previousCameraState, 
      current: cameraStateRef.current, 
      isCameraActive,
      hasCameraStream: !!cameraStream
    });
  }, [isCameraActive, cameraStream]);

  // Separate effect to monitor for unexpected camera state changes
  useEffect(() => {
    // Only check for unexpected state changes after a delay to avoid race conditions
    const timeoutId = setTimeout(() => {
      // Check if camera stream exists but camera is marked as inactive
      // This should only happen if there's a genuine issue, not during normal transitions
      if (cameraStream && cameraStream.getTracks().length > 0 && !isCameraActive) {
        console.log('📹 Unexpected camera state detected - stream exists but camera marked inactive');
        console.log('📹 Stream tracks:', cameraStream.getTracks().length);
        console.log('📹 Video tracks:', cameraStream.getVideoTracks().length);
        console.log('📹 Audio tracks:', cameraStream.getAudioTracks().length);
        
        // Only restore if we have active video tracks
        const videoTracks = cameraStream.getVideoTracks();
        if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
          console.log('📹 Restoring camera state - video track is live');
          setIsCameraActive(true);
          cameraStateRef.current = true;
        }
      }
      
      // Also check for the opposite case - camera marked active but no stream
      if (isCameraActive && (!cameraStream || cameraStream.getTracks().length === 0)) {
        console.log('📹 Camera marked active but no stream - this should not happen');
        console.log('📹 Current state:', { isCameraActive, hasCameraStream: !!cameraStream });
      }
    }, 500); // Wait 500ms to avoid race conditions

    return () => clearTimeout(timeoutId);
  }, [cameraStream, isCameraActive]);

  // Add global debugging function
  useEffect(() => {
    (window as any).debugCameraState = () => {
      console.log('📹 Current camera state:', {
        isCameraActive,
        hasCameraStream: !!cameraStream,
        cameraStateRef: cameraStateRef.current,
        streamTracks: cameraStream?.getTracks().length || 0,
        videoTracks: cameraStream?.getVideoTracks().length || 0,
        audioTracks: cameraStream?.getAudioTracks().length || 0,
        hasCameraRef: !!cameraVideoRef.current
      });
    };
    
    // Call it immediately to show current state
    (window as any).debugCameraState();
  }, [isCameraActive, cameraStream]);

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
        // Voice detection will be started from within grab() function after session is ready

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
      
      // Cleanup speaking timer
      if (speakingTimerRef.current) {
        clearTimeout(speakingTimerRef.current);
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
    // Store sessionId in ref for immediate access in voice detection
    sessionIdRef.current = res.sessionId || null;
    setStream(avatar.current!.mediaStream);
    setIsSessionStarted(true);
    
    // Note: Don't clear media context here as it might be needed for ongoing analysis
    
    setLoadingProgress(100);
    
    // Clear loading states
    setStartLoading(false);
    setStartAvatarLoading(false);
    
    // Start voice chat and pre-warm in parallel (non-blocking)
    // Add delay to ensure avatar session is fully ready before starting voice detection
    setTimeout(() => {
      Promise.all([
        startContinuousListening(),
        preWarmAvatarForResponse()
      ]).catch(error => {
        console.warn('Background initialization failed:', error);
      });
    }, 2000); // Wait 2 seconds for avatar to be fully ready
    
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
  console.log('📹 Camera button clicked! Current state:', { isCameraActive, hasCameraStream: !!cameraStream });
  
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
    
    // Update camera state ref for voice detection
    const previousCameraState = cameraStateRef.current;
    cameraStateRef.current = false;
    cameraStreamRef.current = null;
    console.log('📹 Camera deactivated - voice threshold should now be 30:', {
      previous: previousCameraState,
      current: cameraStateRef.current
    });
    
  } else {
    // Start camera with rear-facing preference
    console.log('📹 Starting camera activation...');
    try {
      // Try to get rear-facing camera first
      let stream: MediaStream;
      
      try {
        // Request rear-facing/primary camera with audio for voice detection
        console.log('📹 Requesting rear-facing camera with audio...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 320 },
            height: { ideal: 240 },
            facingMode: { ideal: 'environment' } // Rear-facing camera
          },
          audio: true // Enable audio for voice detection
        });
        console.log('📹 Rear-facing camera obtained successfully');
      } catch (rearError) {
        console.log('📹 Rear camera not available, trying any camera...', rearError);
        // Fallback to any available camera with audio
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 320 },
            height: { ideal: 240 }
          },
          audio: true // Enable audio for voice detection
        });
        console.log('📹 Fallback camera obtained successfully');
      }
      
      setCameraStream(stream);
      setIsCameraActive(true);
      
      // Update refs immediately for voice detection
      cameraStateRef.current = true;
      cameraStreamRef.current = stream;
      
      console.log('📹 Camera activated successfully:', {
        hasStream: !!stream,
        streamTracks: stream.getTracks().length,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
        cameraStateRef: cameraStateRef.current
      });
      
      console.log('📹 Camera state ref updated to true - voice threshold should now be 20');
      
      // Add immediate verification
      setTimeout(() => {
        console.log('📹 Camera activation verification:', {
          isCameraActive,
          cameraStateRef: cameraStateRef.current,
          hasCameraStream: !!cameraStream,
          streamTracks: cameraStream?.getTracks().length || 0
        });
        
        // Test voice threshold calculation
        const testThreshold = cameraStateRef.current ? 20 : 30;
        console.log('📹 Voice threshold test:', { 
          cameraStateRef: cameraStateRef.current, 
          expectedThreshold: 20, 
          calculatedThreshold: testThreshold 
        });
      }, 100);
      
      // Camera is now passive - only analyzes when user asks something
      // No automatic analysis interval
      
    } catch (error) {
      console.error('Error accessing camera:', error);
    }
  }
};

const handleMotionDetected = () => {
  // Motion detected - user is moving
  // console.log('👀 Ooh! I see some movement! Someone is getting active!');
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
          max_tokens: 100,   
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
  const currentCameraState = getCurrentCameraState();
  console.log('🎭 Camera state:', { 
    ...currentCameraState,
    hasCameraRef: !!cameraVideoRef.current,
    cameraVideoDimensions: cameraVideoRef.current ? {
      videoWidth: cameraVideoRef.current.videoWidth,
      videoHeight: cameraVideoRef.current.videoHeight
    } : null
  });
  
  setIsAnalyzing(true);
  
  try {
    // Check if camera is active and has video element
    if (!currentCameraState.isActive || !currentCameraState.hasStream) {
      console.error('🎭 Camera not active or no stream available:', {
        ...currentCameraState,
        hasCameraRef: !!cameraVideoRef.current
      });
      const errorResponse = "I can't see anything right now because the camera isn't active. Please make sure the camera is turned on and try again.";
      analysisQueueRef.current.push(errorResponse);
      if (!isProcessingQueueRef.current) {
        processAnalysisQueue();
      }
      return;
    }
    
    // Additional check: ensure camera stream has video tracks
    const videoTracks = currentCameraState.stream?.getVideoTracks() || [];
    if (videoTracks.length === 0) {
      console.error('🎭 Camera stream has no video tracks');
      const errorResponse = "I can't see anything because the camera feed isn't working properly. Please try turning the camera off and on again.";
      analysisQueueRef.current.push(errorResponse);
      if (!isProcessingQueueRef.current) {
        processAnalysisQueue();
      }
      return;
    }
    
    if (!cameraVideoRef.current) {
      console.error('🎭 Camera video element not available');
      const errorResponse = "I can't access the camera feed right now. Please make sure the camera is working properly.";
      analysisQueueRef.current.push(errorResponse);
      if (!isProcessingQueueRef.current) {
        processAnalysisQueue();
      }
      return;
    }
    
    // Capture current frame for analysis
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('🎭 Could not get canvas context');
      return;
    }
    
    // Wait a moment for video to be ready
    if (cameraVideoRef.current.videoWidth === 0 || cameraVideoRef.current.videoHeight === 0) {
      console.log('🎭 Video not ready yet, waiting...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (cameraVideoRef.current.videoWidth === 0 || cameraVideoRef.current.videoHeight === 0) {
      console.error('🎭 Video dimensions still not available');
      const errorResponse = "I can't see the camera feed properly. The video might not be ready yet.";
      analysisQueueRef.current.push(errorResponse);
      if (!isProcessingQueueRef.current) {
        processAnalysisQueue();
      }
      return;
    }
    
    canvas.width = cameraVideoRef.current.videoWidth;
    canvas.height = cameraVideoRef.current.videoHeight;
    ctx.drawImage(cameraVideoRef.current, 0, 0);
    
    // Convert to base64 for OpenAI Vision API
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    console.log('Image data:', imageData);
    // Analyze with OpenAI Vision using conversational approach
    const response = await createApiCall(
      async () => {
        const stream = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a helpful, hilarious AI assistant that analyzes images in a natural, conversational and funny way. When someone asks you about what you see, respond as if you're having a normal conversation with them. Be friendly, descriptive, and helpful. Keep responses conversational and under 150 words.`
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
          max_tokens: 100,
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
      console.log('👁️ Adding vision analysis to queue:', analysis.trim());
      analysisQueueRef.current.push(analysis.trim());
      console.log('👁️ Queue length after adding:', analysisQueueRef.current.length);
      console.log('👁️ Is processing queue:', isProcessingQueueRef.current);
      console.log('👁️ Avatar speaking:', isAvatarSpeakingRef.current);
      
      if (!isProcessingQueueRef.current) {
        console.log('👁️ Starting queue processing...');
        processAnalysisQueue();
      } else {
        console.log('👁️ Queue is already processing, will process when current item finishes');
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
    
    // Add conversation history
    messages.push(...conversationHistory);
    
    // Add current user message
    messages.push({ role: 'user', content: selectedPrompt });
    
    createApiCall(
      () => openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: 100, // Reduced for faster response
        temperature: 0.8
      }),
      { timeout: 20000, retries: 2 }
    ).then((aiResponse: any) => {
      setInput(aiResponse.choices[0].message.content || '');
      console.log("INPUT", input);
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
        
        {/* Avatar speaking indicator - main view */}
        {!isCameraActive && isAvatarSpeaking && (
          <div className="absolute top-4 left-4 z-30">
            <div className="flex items-center space-x-2 bg-black/70 rounded-full px-3 py-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse">
                <div className="absolute inset-0 bg-green-400 rounded-full animate-ping"></div>
              </div>
              <span className="text-white text-sm font-medium">Avatar Speaking</span>
            </div>
          </div>
        )}
        
        {/* User talking indicator */}
        {isUserTalking && (
          <div className="absolute top-4 right-4 z-30">
            <div className="flex items-center space-x-2 bg-blue-600/70 rounded-full px-3 py-2">
              <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse">
                <div className="absolute inset-0 bg-blue-300 rounded-full animate-ping"></div>
              </div>
              <span className="text-white text-sm font-medium">You're Speaking</span>
            </div>
          </div>
        )}
        
        {/* Camera vision ready indicator */}
        {isCameraActive && cameraStream && (
          <div className="absolute top-4 left-4 z-30">
            <div className="flex items-center space-x-2 bg-green-600/70 rounded-full px-3 py-2">
              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse">
                <div className="absolute inset-0 bg-green-300 rounded-full animate-ping"></div>
              </div>
              <span className="text-white text-sm font-medium">Vision Ready</span>
            </div>
          </div>
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
        {/* Avatar speaking indicator */}
        {isAvatarSpeaking && (
          <div className="absolute top-1 right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-lg">
            <div className="absolute inset-0 bg-green-400 rounded-full animate-ping"></div>
          </div>
        )}
        
        {/* User talking indicator for camera mode */}
        {isUserTalking && (
          <div className="absolute top-1 left-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse shadow-lg">
            <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping"></div>
          </div>
        )}
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

      {/* Avatar Control Panel - Top Right */}
      {/* {isSessionStarted && (
        <div className="absolute top-4 right-4 z-30 flex flex-col gap-2">
          <div className="bg-black/70 rounded-lg p-2 flex flex-col gap-1">

            <div className="text-xs text-white/70 mb-1">
              Avatar: {isAvatarSpeaking ? 'Speaking' : 'Silent'} | User: {isUserTalking ? 'Talking' : 'Silent'}
            </div>
            <div className="text-xs text-white/50 mb-1">
              Ref: {isAvatarSpeakingRef.current ? 'True' : 'False'} | Timer: {speakingTimerRef.current ? 'Active' : 'None'} | Audio: {audioDetectionRef.current ? 'Detecting' : 'Off'}
            </div>
            <button
              onClick={() => startAvatarSpeaking("Hello! I'm ready to help you.")}
              disabled={isAvatarSpeaking}
              className={`px-3 py-1 text-xs rounded ${
                isAvatarSpeaking 
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              Start Avatar
            </button>
            <button
              onClick={stopAvatarSpeaking}
              disabled={!isAvatarSpeaking}
              className={`px-3 py-1 text-xs rounded ${
                !isAvatarSpeaking 
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
              title={isAvatarSpeaking ? 'Stop the avatar from speaking' : 'Avatar is not speaking'}
            >
              Stop Avatar {isAvatarSpeaking ? '✓' : '✗'}
            </button>
            <button
              onClick={interruptAvatarSpeaking}
              disabled={!isAvatarSpeaking}
              className={`px-3 py-1 text-xs rounded ${
                !isAvatarSpeaking 
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                  : 'bg-orange-600 hover:bg-orange-700 text-white'
              }`}
              title={isAvatarSpeaking ? 'Interrupt the avatar immediately' : 'Avatar is not speaking'}
            >
              Interrupt {isAvatarSpeaking ? '✓' : '✗'}
            </button>
            <button
              onClick={() => {
                console.log('🎭 Force stopping avatar - clearing all timers and state');
                if (mediaStream.current) {
                  mediaStream.current.muted = true;
                  mediaStream.current.volume = 0;
                  console.log('🎭 Avatar audio muted in force stop');
                }
                resetAvatarSpeakingState();
              }}
              className="px-3 py-1 text-xs rounded bg-purple-600 hover:bg-purple-700 text-white"
              title="Force stop avatar (emergency override) - mutes audio"
            >
              Force Stop
            </button>
            <button
              onClick={resetAvatarSpeakingState}
              className="px-3 py-1 text-xs rounded bg-orange-600 hover:bg-orange-700 text-white"
              title="Reset avatar speaking state (for stuck states)"
            >
              Reset State
            </button>
            <button
              onClick={() => {
                console.log('🎭 Unmuting avatar audio');
                if (mediaStream.current) {
                  mediaStream.current.muted = false;
                  mediaStream.current.volume = 1.0;
                  console.log('🎭 Avatar audio unmuted');
                }
              }}
              className="px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white"
              title="Unmute avatar audio"
            >
              Unmute
            </button>
          </div>
        </div>
      )} */}

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

