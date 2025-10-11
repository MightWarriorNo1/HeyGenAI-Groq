/*eslint-disable*/
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import OpenAI from 'openai';
import { Toaster } from "@/components/ui/toaster";

const BrandHeader = lazy(() => import('./components/reusable/BrandHeader'));

function App() {
  const { toast } = useToast();

  // States
  const [startLoading, setStartLoading] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [input, setInput] = useState("");
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string, content: string}>>([]);
  const [dynamicButtons, setDynamicButtons] = useState<any[]>([]);
  const [analysisQueue, setAnalysisQueue] = useState<string[]>([]);
  const [volume, setVolume] = useState(1);
  const [cameraStreamActive, setCameraStreamActive] = useState(false);

  // References
  const avatar = useRef<any>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const isProcessingQueueRef = useRef(false);
  const analysisQueueRef = useRef<string[]>([]);
  const preWarmAvatar = useRef(false);

  // Silence detection timeout reduced for faster detection (800ms)
  const silenceTimeout = 800;

  // Initialize OpenAI
  const openai = new OpenAI({
    apiKey: import.meta.env.VITEOPENAI_API_KEY,
  });

  // Sync analysisQueue with ref for processing
  useEffect(() => {
    analysisQueueRef.current = analysisQueue;
    if (analysisQueue.length > 0) processAnalysisQueue();
  }, [analysisQueue]);

  // Continuous voice listening with reduced silence timeout
  const startContinuousListening = () => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);

      let isRecording = false;
      let silenceStart: number | null = null;
      const voiceThreshold = 30;

      const checkVoice = () => {
        analyser.getByteFrequencyData(dataArray);
        const avgVolume = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

        if (avgVolume > voiceThreshold && !isRecording) {
          console.log('🎤 Voice detected, start recording...');
          isRecording = true;
          silenceStart = null;

          mediaRecorder.current = new MediaRecorder(stream);
          audioChunks.current = [];

          mediaRecorder.current.ondataavailable = (e: BlobEvent) => {
            if (e.data.size > 0) {
              audioChunks.current.push(e.data);
            }
          };

          mediaRecorder.current.onstop = async () => {
            const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
            audioChunks.current = [];
            setIsSpeaking(true);
            await transcribeAudio(audioBlob);
            setIsSpeaking(false);
            isRecording = false;
          };

          mediaRecorder.current.start();

        } else if (avgVolume < voiceThreshold && isRecording) {
          if (!silenceStart) silenceStart = Date.now();
          if (Date.now() - silenceStart >= silenceTimeout) {
            console.log('🤫 Silence detected, stopping recording.');
            if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
              mediaRecorder.current.stop();
            }
            silenceStart = null;
          }
        } else if (avgVolume > voiceThreshold && isRecording) {
          silenceStart = null; // reset silence timer on voice detected
        }

        requestAnimationFrame(checkVoice);
      };

      checkVoice();
    }).catch((err) => {
      toast({ title: "Microphone Access Error", description: err.message, variant: "destructive" });
    });
  };

  // Transcribe audio using OpenAI Whisper, then chat/completion and avatar speak
  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      setStartLoading(true);

      // Upload audio blob to OpenAI Whisper (replace with your actual call)
      const transcriptionResponse = await openai.audio.transcriptions.create({
        file: audioBlob as any,
        model: 'whisper-1',
      });

      const transcription = transcriptionResponse.text || "";
      setInput(transcription);

      // Create conversation user message
      const userMessage = { role: 'user' as const, content: transcription };
      const newConversation = [...conversationHistory, userMessage];
      setConversationHistory(newConversation);

      // Send to GPT chat completion with streaming enabled
      const responseStream = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: newConversation as any,
        max_tokens: 150,
        temperature: 0.7,
        stream: true,
      });

      let assistantResponse = "";
      setIsSpeaking(true);

      for await (const chunk of responseStream) {
        if (chunk.choices[0]?.delta?.content) {
          assistantResponse += chunk.choices[0].delta.content;

          // Push partial responses to avatar speak queue to begin quickly
          const content = chunk.choices[0].delta.content;
          if (content) {
            setAnalysisQueue((prev) => [...prev, content]);
          }
        }
      }

      setConversationHistory([...newConversation, { role: 'assistant' as const, content: assistantResponse }]);
      setIsSpeaking(false);
      setStartLoading(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
      setStartLoading(false);
      setIsSpeaking(false);
    }
  };

  // Process avatar speak queue with immediate start on queued text chunks
  const processAnalysisQueue = async () => {
    if (isProcessingQueueRef.current || analysisQueueRef.current.length === 0) return;
    isProcessingQueueRef.current = true;

    const text = analysisQueueRef.current.shift();
    if (text && avatar.current && typeof avatar.current.speak === 'function') {
      try {
        await avatar.current.speak({
          taskRequest: { text },
          sessionId: avatar.current.sessionId,
        });
      } catch (e) {
        console.error("Avatar speak error:", e);
      }
    }

    isProcessingQueueRef.current = false;

    if (analysisQueueRef.current.length > 0) {
      setTimeout(processAnalysisQueue, 200); // quickly process next
    }
  };

  // Keep avatar session warm by speaking 'Ready' every minute
  useEffect(() => {
    if (!preWarmAvatar.current && avatar.current?.sessionId) {
      preWarmAvatar.current = true;

      const intervalId = setInterval(async () => {
        try {
          if (avatar.current && typeof avatar.current.speak === 'function') {
            await avatar.current.speak({ 
              taskRequest: { text: 'Ready' }, 
              sessionId: avatar.current.sessionId 
            });
          }
        } catch (e) {
          console.warn("Avatar prewarm failed", e);
        }
      }, 60000);

      return () => clearInterval(intervalId);
    }
  }, [avatar.current?.sessionId]);

  // TODO: Add UI rendering, button handlers, camera stream activation, and other code here…

  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <BrandHeader />
        <Toaster />
        {/* UI and video display components */}
      </Suspense>
    </>
  );
}

export default App;
