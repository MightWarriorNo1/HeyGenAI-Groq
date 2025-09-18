import { useState, useRef, useEffect } from 'react';
import { FaCamera, FaVideo, FaStop, FaTimes, FaDownload, FaEye } from 'react-icons/fa';
import { Loader2 } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File, type: 'photo' | 'video') => void;
  onVisionAnalysis?: (imageDataUrl: string) => void;
}

const CameraModal = ({ isOpen, onClose, onCapture, onVisionAnalysis }: CameraModalProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [capturedMedia, setCapturedMedia] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isVisionProcessing, setIsVisionProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [isOpen]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: true
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsRecording(false);
    setCapturedMedia(null);
    setMediaType(null);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const context = canvas.getContext('2d');
      
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            setCapturedMedia(url);
            setMediaType('photo');
            onCapture(file, 'photo');
          }
        }, 'image/jpeg', 0.8);
      }
    }
  };

  const startVideoRecording = () => {
    if (stream) {
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const file = new File([blob], `video_${Date.now()}.webm`, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setCapturedMedia(url);
        setMediaType('video');
        onCapture(file, 'video');
      };

      mediaRecorder.start();
      setIsRecording(true);
    }
  };

  const stopVideoRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const retakeMedia = () => {
    setCapturedMedia(null);
    setMediaType(null);
  };

  const downloadMedia = () => {
    if (capturedMedia) {
      const link = document.createElement('a');
      link.href = capturedMedia;
      link.download = `captured_${Date.now()}.${mediaType === 'photo' ? 'jpg' : 'webm'}`;
      link.click();
    }
  };

  const handleVisionAnalysis = async () => {
    if (!videoRef.current || !canvasRef.current || !onVisionAnalysis) return;
    
    setIsVisionProcessing(true);
    
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const context = canvas.getContext('2d');
      
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        
        // Convert canvas to data URL
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // Call the vision analysis function
        await onVisionAnalysis(imageDataUrl);
      }
    } catch (error) {
      console.error('Error processing vision analysis:', error);
    } finally {
      setIsVisionProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-4 sm:p-6 max-w-md w-full mx-2 sm:mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg sm:text-xl font-bold">Camera</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
          >
            <FaTimes size={18} className="sm:w-5 sm:h-5" />
          </button>
        </div>

        <div className="relative">
          {!capturedMedia ? (
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-96 sm:h-64 bg-black rounded-lg"
              />
              <canvas ref={canvasRef} className="hidden" />
              
              <div className="absolute bottom-2 sm:bottom-4 left-1/2 transform -translate-x-1/2 flex gap-3 sm:gap-4">
                <button
                  onClick={capturePhoto}
                  className="bg-white p-2.5 sm:p-3 rounded-full shadow-lg hover:bg-gray-100"
                  title="Take Photo"
                >
                  <FaCamera size={18} className="text-gray-700 sm:w-5 sm:h-5" />
                </button>
                
                <button
                  onClick={isRecording ? stopVideoRecording : startVideoRecording}
                  className={`p-2.5 sm:p-3 rounded-full shadow-lg ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 text-white' 
                      : 'bg-white hover:bg-gray-100'
                  }`}
                  title={isRecording ? 'Stop Recording' : 'Record Video'}
                >
                  {isRecording ? <FaStop size={18} className="sm:w-5 sm:h-5" /> : <FaVideo size={18} className="text-gray-700 sm:w-5 sm:h-5" />}
                </button>

                {onVisionAnalysis && (
                  <button
                    onClick={handleVisionAnalysis}
                    disabled={isVisionProcessing}
                    className={`p-2.5 sm:p-3 rounded-full shadow-lg transition-all duration-200 ${
                      isVisionProcessing 
                        ? 'bg-purple-400 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white'
                    }`}
                    title={isVisionProcessing ? 'Analyzing...' : 'Analyze with AI Vision'}
                  >
                    {isVisionProcessing ? (
                      <Loader2 size={18} className="animate-spin sm:w-5 sm:h-5" />
                    ) : (
                      <FaEye size={18} className="sm:w-5 sm:h-5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {mediaType === 'photo' ? (
                <img
                  src={capturedMedia}
                  alt="Captured photo"
                  className="w-full h-48 sm:h-64 object-cover rounded-lg"
                />
              ) : (
                <video
                  src={capturedMedia}
                  controls
                  className="w-full h-48 sm:h-64 bg-black rounded-lg"
                />
              )}
              
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  onClick={retakeMedia}
                  className="px-3 sm:px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 text-sm sm:text-base"
                >
                  Retake
                </button>
                <button
                  onClick={downloadMedia}
                  className="px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center justify-center gap-2 text-sm sm:text-base"
                >
                  <FaDownload size={14} className="sm:w-4 sm:h-4" />
                  Download
                </button>
                <button
                  onClick={onClose}
                  className="px-3 sm:px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm sm:text-base"
                >
                  Use This
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CameraModal;
