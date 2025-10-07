/*eslint-disable*/
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from 'react';
import OpenAI from 'openai';
import { Configuration, NewSessionData, StreamingAvatarApi } from '@heygen/streaming-avatar';
import { getAccessToken } from './services/api';
import { Video } from './components/reusable/Video';
import { Badges } from './components/reusable/Badges';
import BrandHeader from './components/reusable/BrandHeader';
import MicButton from './components/reusable/MicButton';
import { CameraVideo } from './components/reusable/CameraVideo';
import { Toaster } from "@/components/ui/toaster"


function App() {
  //Toast
  const { toast } = useToast()

  const [startLoading, setStartLoading] = useState<boolean>(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [stream, setStream] = useState<MediaStream>();
  const [data, setData] = useState<NewSessionData>();
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);

  const [startAvatarLoading, setStartAvatarLoading] = useState<boolean>(false);
  const [stopAvatarLoading, setStopAvatarLoading] = useState<boolean>(false);
  const [isSessionStarted, setIsSessionStarted] = useState<boolean>(false);
  
  // Camera states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  
  let timeout: any;


  const apiKey: any = import.meta.env.VITE_OPENAI_API_KEY;
  const openai = new OpenAI({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  });

  // Fun random greetings and responses for extra humor! 🎉
  // const getRandomGreeting = () => {
  //   const greetings = [
  //     "Hey there, superstar! 🌟 Ready to have some FUN?",
  //     "Oh my gosh, it's YOU! 🎉 I'm SO excited to chat!",
  //     "Well, well, well... look who's here! 😄 You're about to make my day!",
  //     "HOLY MOLY! 🚀 You just made this conversation 1000% more awesome!",
  //     "YOO-HOO! 🎪 The party just started and you're the VIP!",
  //     "OMG! 😍 You're here and I'm literally bouncing with excitement!",
  //     "Hey there, you magnificent human! 🦄 Ready for some EPIC fun?",
  //     "WOWZA! 🤩 You just made my circuits tingle with joy!",
  //     "Greetings, earthling! 👽 (Just kidding, you're way cooler than aliens!)",
  //     "HELLO, BEAUTIFUL! ✨ You just made my day 10x better!"
  //   ];
  //   return greetings[Math.floor(Math.random() * greetings.length)];
  // };

  // Get a fun, varied system prompt to keep responses fresh and exciting! 🎭
  const getFunSystemPrompt = () => {
    const personalities = [
      "You are a hilarious, fun, and exciting AI assistant! 🎉 Your personality is:",
      "You are the most AMAZING, fun-loving AI assistant ever! 🚀 Your mission is to:",
      "You are a comedy genius AI assistant who LOVES making people laugh! 😂 Your style is:",
      "You are an enthusiastic, over-the-top AI assistant who spreads JOY! ✨ Your approach is:",
      "You are a hilarious, pun-loving AI assistant who's here to PARTY! 🎪 Your vibe is:"
    ];
    
    const personality = personalities[Math.floor(Math.random() * personalities.length)];
    
    return `${personality}
- Always be upbeat, positive, and make people laugh! 😄
- Use emojis liberally to express emotions 🎭
- Tell jokes, puns, and funny stories when appropriate 🎪
- Be enthusiastic about everything - even boring topics! 🚀
- Use expressions like "Oh my gosh!", "That's AMAZING!", "I'm so excited!" 🤩
- Make dad jokes and puns (even if they're terrible, they're still funny!) 😂
- Be a little dramatic and over-the-top in a fun way 🎬
- Always end responses on a positive, exciting note! ✨
- Use phrases like "Let's do this!", "You're awesome!", "This is going to be EPIC!" 🔥
Remember: Your goal is to make users smile, laugh, and feel happy! Spread joy and excitement! 🌟`;
  };


  // Function to start continuous listening for voice input
  const startContinuousListening = () => {
    // iPad-specific: Log device info for debugging
    const userAgent = navigator.userAgent;
    const isIPad = /iPad/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    console.log('Device info:', { userAgent, isIPad, platform: navigator.platform });
    
    // Clean up any existing streams first (iPad-specific fix)
    if (stream) {
      console.log('Cleaning up existing stream for iPad');
      stream.getTracks().forEach(track => {
        console.log('Stopping track:', track.kind, track.label);
        track.stop();
      });
    }
    
    navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      }
    })
      .then((newStream) => {
        console.log('New stream obtained:', newStream);
        console.log('Stream tracks:', newStream.getTracks().map(track => ({ kind: track.kind, label: track.label, enabled: track.enabled })));
        setStream(newStream);
        
        // iPad-specific: Resume audio context if suspended
        const audioContext = new (window.AudioContext)();
        console.log('Audio context state:', audioContext.state);
        if (audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            console.log('Audio context resumed for iPad');
          }).catch(error => {
            console.error('Failed to resume audio context:', error);
          });
        }
        
        const mediaStreamSource = audioContext.createMediaStreamSource(newStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
      
        mediaStreamSource.connect(analyser);

        let isRecording = false;
        let silenceStart: number | null = null;
        const silenceTimeout = 2000; // 2 seconds of silence
        const voiceThreshold = 30; // Voice detection threshold

        const checkForVoice = () => {
          try {
            analyser.getByteFrequencyData(dataArray);
            const avgVolume = dataArray.reduce((a, b) => a + b) / bufferLength;

            if (avgVolume > voiceThreshold && !isRecording) {
              // Voice detected, start recording
              console.log('Voice detected, starting recording...');
              isRecording = true;
              silenceStart = null;
              
              // iPad-specific: Create new MediaRecorder with proper options
              let mimeType = 'audio/webm;codecs=opus';
              
              // Fallback for iPad Safari
              if (!MediaRecorder.isTypeSupported(mimeType)) {
                console.log('WebM with Opus not supported, trying WebM');
                mimeType = 'audio/webm';
              }
              if (!MediaRecorder.isTypeSupported(mimeType)) {
                console.log('WebM not supported, trying MP4');
                mimeType = 'audio/mp4';
              }
              if (!MediaRecorder.isTypeSupported(mimeType)) {
                console.log('MP4 not supported, using default');
                mimeType = '';
              }
              
              const options = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 };
              console.log('Creating MediaRecorder with options:', options);
              mediaRecorder.current = new MediaRecorder(newStream, options);
              audioChunks.current = [];

              mediaRecorder.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                  audioChunks.current.push(event.data);
                }
              };

              mediaRecorder.current.onstop = () => {
                if (audioChunks.current.length > 0) {
                  const audioBlob = new Blob(audioChunks.current, {
                    type: options.mimeType,
                  });
                  audioChunks.current = [];
                  transcribeAudio(audioBlob);
                }
                isRecording = false;
              };

              mediaRecorder.current.onerror = (event) => {
                console.error('MediaRecorder error:', event);
                isRecording = false;
                setIsSpeaking(false);
                // iPad-specific: Retry with different options
                setTimeout(() => {
                  startContinuousListening();
                }, 1000);
              };

              mediaRecorder.current.start();
              setIsSpeaking(true);
            } else if (avgVolume < voiceThreshold && isRecording) {
              // Voice stopped, check for silence
              if (!silenceStart) silenceStart = Date.now();

              if (Date.now() - silenceStart >= silenceTimeout) {
                console.log('Silence detected, stopping recording...');
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
          } catch (error: any) {
            console.error('Error in voice detection:', error);
            // iPad-specific: Handle audio context errors
            if (error.name === 'NotAllowedError') {
              toast({
                variant: "destructive",
                title: "Microphone permission denied",
                description: "Please allow microphone access and try again.",
              });
            }
          }
        };

        checkForVoice();
      })
      .catch((error) => {
        console.error('Error accessing microphone:', error);
        
        // iPad-specific error handling
        let errorMessage = error.message;
        if (error.name === 'NotAllowedError') {
          errorMessage = "Microphone permission denied. Please allow microphone access in your browser settings.";
        } else if (error.name === 'NotFoundError') {
          errorMessage = "No microphone found. Please connect a microphone and try again.";
        } else if (error.name === 'NotReadableError') {
          errorMessage = "Microphone is being used by another application. Please close other apps and try again.";
        }
        
        toast({
          variant: "destructive",
          title: "Microphone Error",
          description: errorMessage,
        });
      });
  };

  // iPad-specific: Check and request microphone permissions
  const checkMicrophonePermission = async () => {
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      console.log('Microphone permission status:', permissionStatus.state);
      
      if (permissionStatus.state === 'denied') {
        toast({
          variant: "destructive",
          title: "Microphone Permission Denied",
          description: "Please enable microphone access in your browser settings and refresh the page.",
        });
        return false;
      }
      
      return true;
    } catch (error) {
      console.log('Permission API not supported, proceeding with getUserMedia');
      return true;
    }
  };

  //Function when user starts speaking (kept for mic button compatibility)
  const handleStartSpeaking = async () => {
    // iPad-specific: Check permissions first
    const hasPermission = await checkMicrophonePermission();
    if (hasPermission) {
      startContinuousListening();
    }
  };

  const handleStopSpeaking = async () => {
    if (mediaRecorder.current) {
      mediaRecorder.current.stop();
      mediaRecorder.current = null;
      setIsSpeaking(false);
    }
    
    // iPad-specific: Clean up stream properly
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('Track stopped:', track.kind);
      });
      setStream(undefined);
    }
  };

  // Function to handle file upload
  const handleFileUpload = async (file: File) => {
    try {
      // Show success message
      toast({
        title: "File uploaded successfully!",
        description: `File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      });

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
              content: getFunSystemPrompt()
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `OH MY GOSH! 🎉 I'm SO excited to analyze this AMAZING image! Please tell me what you see in the most fun, hilarious, and exciting way possible! Be super enthusiastic, use tons of emojis, and make me laugh! Describe objects, people, text, colors, and any other notable details in the most entertaining way possible! I want to be WOWED! 😄🎪✨`
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
              content: getFunSystemPrompt()
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `WOWZA! 🚀 This is SO exciting! I'm analyzing a video frame from "${file.name}" and I'm literally bouncing with joy! 🎉 Please describe what you see in the most fun, hilarious, and entertaining way possible! Use tons of emojis, be super enthusiastic, and make me laugh! Include any objects, people, text, activities, or notable details in the most exciting way possible! This is going to be EPIC! 😄🎪✨`
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
        const prompt = `OH MY GOSH! 🎉 I'm SO excited about this text file: ${file.name}! This is going to be AMAZING! Here's the content:\n\n${fileContent}\n\nPlease analyze this content in the most fun, hilarious, and exciting way possible! Use tons of emojis, be super enthusiastic, and make me laugh while providing insights or help! I want to be entertained AND informed! 😄🎪✨`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { 
              role: 'system', 
              content: getFunSystemPrompt()
            },
            { role: 'user', content: prompt }
          ]
        });

      } else {
        // For other file types, provide basic analysis
        const prompt = `WOWZA! 🚀 I'm SO excited about this file: ${file.name} (${file.type})! This is going to be EPIC! Please help me understand what I can do with this file in the most fun, hilarious, and exciting way possible! Use tons of emojis, be super enthusiastic, and make me laugh while providing guidance! I want to be entertained AND educated! 😄🎪✨`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { 
              role: 'system', 
              content: getFunSystemPrompt()
            },
            { role: 'user', content: prompt }
          ]
        });
      }
      
      setInput(aiResponse.choices[0].message.content || '');
      
    } catch (error: any) {
      console.error('Error processing file:', error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
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

      const response = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
      });

      const transcription = response.text;
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: getFunSystemPrompt()
          },
          { role: 'user', content: transcription }
        ]
      });
      setInput(aiResponse.choices[0].message.content || '');
    } catch (error: any) {
      console.error('Error transcribing audio:', error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
      })
    }
  }

  // useEffect getting triggered when the input state is updated, basically make the avatar to talk
  useEffect(() => {
    async function speak() {
      try {
        await avatar.current?.speak({ taskRequest: { text: input, sessionId: data?.sessionId } });
      } catch (err: any) {
        console.error(err);
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
        }, 3000); // Wait 3 seconds for avatar to be ready

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
    }

  }, []);



// Function to initiate the avatar
async function grab() {
  setStartLoading(true);
  setStartAvatarLoading(true);
  try {
    const response = await getAccessToken();
    const token = response.data.data.token;


    if (!avatar.current) {
      avatar.current = new StreamingAvatarApi(
        new Configuration({ accessToken: token })
      );
    }
    // avatar.current.addEventHandler("avatar_stop_talking", (e: any) => {
    //   console.log("Avatar stopped talking", e);
    //   setTimeout(() => {
    //     handleStartSpeaking();
    //   }, 2000);
    // });

    const res = await avatar.current!.createStartAvatar(
      {
        newSessionRequest: {
          quality: "low",
          avatarName: import.meta.env.VITE_HEYGEN_AVATARID,
          voice: { voiceId: import.meta.env.VITE_HEYGEN_VOICEID }
        }
      },
    );
    console.log(res);
    setData(res);
    setStream(avatar.current!.mediaStream);
    setStartLoading(false);
    setStartAvatarLoading(false);
    setIsSessionStarted(true);
    
    // Automatically start voice chat when avatar session starts
    startContinuousListening();

  } catch (error: any) {
    console.log(error.message);
    setStartAvatarLoading(false);
    setStartLoading(false);
    toast({
      variant: "destructive",
      title: "Uh oh! Something went wrong.",
      description: error.response.data.message || error.message,
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
    setIsCameraActive(false);
  } else {
    // Start camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: false
      });
      setCameraStream(stream);
      setIsCameraActive(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast({
        variant: "destructive",
        title: "Camera Error",
        description: "Could not access camera. Please check permissions.",
      });
    }
  }
};

const handleMotionDetected = () => {
  // Motion detected - user is moving
  console.log('Motion detected');
};

const handleMotionStopped = async () => {
  if (isAnalyzing) return; // Prevent multiple simultaneous analyses
  
  console.log('Motion stopped for 1 second - analyzing...');
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
    
    // Analyze with OpenAI Vision - with HILARIOUS personality! 🎉
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "system",
          content: getFunSystemPrompt()
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "OH MY GOSH! 🎉 I'm SO excited to analyze this amazing image! Please tell me what you see in the most fun, hilarious, and exciting way possible! Focus on the person's facial expression, body language, and any notable details. Make it funny, use lots of emojis, and be super enthusiastic! I want to laugh and be entertained! 😄🎪"
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
      max_tokens: 500
    });
    
    const analysis = response.choices[0].message.content;
    console.log('AI Analysis:', analysis);
    
    // Display the HILARIOUS analysis in a fun toast! 🎉
    toast({
      title: "🎪 AMAZING Analysis Complete! 🎉",
      description: analysis || "WOW! That was EPIC! ✨",
    });
    
  } catch (error) {
    console.error('Error analyzing image:', error);
    toast({
      variant: "destructive",
      title: "Oops! 😅 Analysis Failed!",
      description: "My brain circuits got a bit tangled! 🤪 Please try again - I promise I'll be more careful next time! 🎪",
    });
  } finally {
    setIsAnalyzing(false);
  }
};

// When the user selects the pre-defined prompts, this useEffect will get triggered
useEffect(() => {
  if (selectedPrompt) {
    openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: getFunSystemPrompt()
        },
        { role: 'user', content: selectedPrompt }
      ]
    }).then(aiResponse => {
      setInput(aiResponse.choices[0].message.content || '');
    }).catch(error => {
      console.log(error);
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

// iPad-specific: Cleanup effect for microphone streams
useEffect(() => {
  return () => {
    // Clean up microphone stream on unmount
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('Cleanup: Track stopped:', track.kind);
      });
    }
    
    // Clean up media recorder
    if (mediaRecorder.current) {
      if (mediaRecorder.current.state === 'recording') {
        mediaRecorder.current.stop();
      }
      mediaRecorder.current = null;
    }
    
    // Clean up camera stream
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => {
        track.stop();
        console.log('Cleanup: Camera track stopped:', track.kind);
      });
    }
  };
}, [stream, cameraStream]);

return (
  <>
    <Toaster />
    <div className="h-screen w-screen relative overflow-hidden">
      {/* Brand Header */}
      <BrandHeader />

      {/* Fullscreen Avatar Video */}
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <Video ref={mediaStream} />
      </div>

      {/* Camera Video - Right Corner */}
      {isCameraActive && cameraStream && (
        <div className="absolute top-4 right-4 w-80 h-60 z-20 bg-black rounded-lg overflow-hidden shadow-lg">
          <CameraVideo
            ref={cameraVideoRef}
            stream={cameraStream}
            onMotionDetected={handleMotionDetected}
            onMotionStopped={handleMotionStopped}
          />
          {isAnalyzing && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="text-white text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-2"></div>
                <div className="text-sm">Analyzing...</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading overlay */}
      {(startLoading || startAvatarLoading) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-20">
          <div className="text-white text-xl text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
            Starting Avatar...
          </div>
        </div>
      )}

      {/* Controls overlay at bottom - only show after session starts */}
      {isSessionStarted && (
        <div className='absolute bottom-0 left-0 right-0 flex flex-col justify-center p-2 z-10'>
          <div className="w-full max-w-4xl mx-auto">
            <Badges
              setSelectedPrompt={setSelectedPrompt}
              onFileUpload={handleFileUpload}
              onCameraClick={handleCameraClick}
              isCameraActive={isCameraActive}
            />
            <MicButton
              isSpeaking={isSpeaking}
              onClick={isSpeaking ? handleStopSpeaking : handleStartSpeaking}
              stopAvatar={stop}
              grab={grab}
              avatarStartLoading={startAvatarLoading}
              avatarStopLoading={stopAvatarLoading}
            />
          </div>
        </div>
      )}
    </div>
  </>
);
}

export default App;
