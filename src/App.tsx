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
  
  // Camera states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  let timeout: any;

  // Function to generate dynamic buttons based on conversation context
  const generateDynamicButtons = async (conversation: Array<{role: string, content: string}>) => {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Based on the conversation context, suggest 4 relevant, witty button prompts that would be interesting to explore next. 
            Each button should be:
            - 1-4 words maximum
            - Witty and intellectually stimulating
            - Relevant to the current conversation topic
            - Use clever wordplay or unexpected connections
            - Include an appropriate emoji
            - Be thought-provoking rather than obvious
            
            Return only the 4 button texts, one per line, no additional formatting.`
          },
          {
            role: 'user',
            content: `Conversation context: ${conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
          }
        ]
      });
      
      const buttons = response.choices[0].message.content?.split('\n').filter(btn => btn.trim()) || [];
      setDynamicButtons(buttons);
    } catch (error) {
      console.error('Error generating dynamic buttons:', error);
      // Fallback to default buttons
      setDynamicButtons([
        "🤔 Mind-Bending Mysteries",
        "💰 Money Magic & Mayhem", 
        "💕 Love & Laughter Therapy",
        "🎭 Life's Comedy Coach"
      ]);
    }
  };

  const apiKey: any = import.meta.env.VITE_OPENAI_API_KEY;
  const openai = new OpenAI({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
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
        const silenceTimeout = 2000; // 2 seconds of silence
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
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Please analyze this image and provide a detailed description. What do you see in this image? Please be specific about objects, people, text, colors, and any other notable details.`
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
        });

        URL.revokeObjectURL(videoUrl);

      } else if (file.type.startsWith('text/')) {
        // Handle text files
        const fileContent = await file.text();
        const prompt = `I've uploaded a text file: ${file.name}. Here's the content:\n\n${fileContent}\n\nPlease analyze this content and provide insights or help with it.`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'user', content: prompt }
          ]
        });

      } else {
        // For other file types, provide basic analysis
        const prompt = `I've uploaded a file: ${file.name} (${file.type}). Please help me understand what I can do with this file and provide any relevant guidance.`;
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
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
      
      // Update conversation history
      const updatedHistory = [...conversationHistory, { role: 'user', content: transcription }];
      setConversationHistory(updatedHistory);
      
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: `You are a clever, witty AI assistant with a sharp mind and surprising insights! Your responses should be:
            - Intellectually stimulating and thought-provoking
            - Use clever wordplay, unexpected connections, and surprising observations
            - Be engaging and conversational while maintaining sophistication
            - Offer unique perspectives that catch people off-guard in delightful ways
            - Use subtle wit and clever turns of phrase rather than obvious jokes
            - Make unexpected but insightful connections between ideas
            - Keep responses conversational and engaging
            - Always end with a clever or surprising insight that makes people think`
          },
          { role: 'user', content: transcription }
        ]
      });
      
      const aiMessage = aiResponse.choices[0].message.content || '';
      setInput(aiMessage);
      
      // Update conversation history with AI response
      const finalHistory = [...updatedHistory, { role: 'assistant', content: aiMessage }];
      setConversationHistory(finalHistory);
      
      // Generate dynamic buttons based on updated conversation
      await generateDynamicButtons(finalHistory);
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
      
      // Cleanup camera analysis interval
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
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
    
    // Initialize with default buttons
    setDynamicButtons([
      "🤔 Mind-Bending Mysteries",
      "💰 Money Magic & Mayhem", 
      "💕 Love & Laughter Therapy",
      "🎭 Life's Comedy Coach"
    ]);
    
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
    // Start camera with front-facing preference
    try {
      // Try to get front-facing camera first
      let stream: MediaStream;
      
      try {
        // Request front-facing camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 320 },
            height: { ideal: 240 },
            facingMode: { ideal: 'user' } // Front-facing camera
          },
          audio: false
        });
      } catch (frontError) {
        console.log('Front camera not available, trying any camera...');
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
      
      // Start periodic analysis every 5 seconds
      analysisIntervalRef.current = setInterval(() => {
        if (cameraVideoRef.current && !isAnalyzing) {
          handleMotionStopped(); // Trigger analysis
        }
      }, 5000);
      
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
  if (isAnalyzing) return; // Prevent multiple simultaneous analyses
  
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
    
    // Analyze with OpenAI Vision
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
          - Use emojis to enhance the humor
          - Make funny comparisons or references
          - Keep it light-hearted and positive
          - Always end with a funny observation or joke
          - Keep responses concise (under 200 characters) for real-time display`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this image and provide a hilarious, witty description of what you see! Focus on the person's facial expression, body language, and any notable details. Make it funny and entertaining! 😄"
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
      max_tokens: 200
    });
    
    const analysis = response.choices[0].message.content;
    console.log('🎪 My hilarious analysis:', analysis);
    
    // Display analysis in a toast
    toast({
      title: "🎭 Real-time Analysis!",
      description: analysis || "I've got some funny observations to share! 😄",
    });
    
  } catch (error) {
    console.error('Error analyzing image:', error);
    toast({
      variant: "destructive",
      title: "My eyes got a bit blurry! 👀💫",
      description: "I couldn't quite see what you're up to there! Maybe try again - I promise I'll be more observant this time! 😄",
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
            <div className="animate-pulse">🎭 Getting my funny face ready...</div>
            <div className="text-sm mt-2 opacity-75">Preparing jokes and witty comebacks! 😄</div>
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
              dynamicButtons={dynamicButtons}
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
