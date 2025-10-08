import { forwardRef, useEffect, useRef } from 'react';

interface CameraVideoProps {
  stream: MediaStream | null;
  onMotionDetected?: () => void;
  onMotionStopped?: () => void;
}

const CameraVideo = forwardRef<HTMLVideoElement, CameraVideoProps>(
  ({ stream, onMotionDetected, onMotionStopped }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previousFrameRef = useRef<ImageData | null>(null);
    const motionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastMotionTimeRef = useRef<number>(0);

    useEffect(() => {
      if (!stream || !ref || typeof ref === 'function') return;

      const video = ref as React.MutableRefObject<HTMLVideoElement>;
      if (video.current) {
        console.log('Setting up video stream:', stream);
        video.current.srcObject = stream;
        video.current.play().catch(console.error);
        
        // Add event listeners for debugging
        video.current.onloadedmetadata = () => {
          console.log('Video metadata loaded:', video.current?.videoWidth, 'x', video.current?.videoHeight);
        };
        
        video.current.oncanplay = () => {
          console.log('Video can play - ready for motion detection');
        };
      }
    }, [stream, ref]);

    useEffect(() => {
      if (!stream) return;

      const video = ref as React.MutableRefObject<HTMLVideoElement>;
      const canvas = canvasRef.current;
      if (!video.current || !canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const detectMotion = () => {
        if (!video.current || !canvas || !ctx) return;
        
        // Check if video is ready
        if (video.current.readyState < 2) {
          requestAnimationFrame(detectMotion);
          return;
        }

        // Set canvas size to match video
        canvas.width = video.current.videoWidth;
        canvas.height = video.current.videoHeight;

        // Draw current frame to canvas
        ctx.drawImage(video.current, 0, 0, canvas.width, canvas.height);
        const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if (previousFrameRef.current) {
          const motion = calculateMotion(previousFrameRef.current, currentFrame);
          console.log('Motion detected:', motion);
          
          if (motion > 0.05) { // Lower threshold for better sensitivity
            lastMotionTimeRef.current = Date.now();
            onMotionDetected?.();
            
            // Clear any existing timeout
            if (motionTimeoutRef.current) {
              clearTimeout(motionTimeoutRef.current);
            }
          } else {
            // Check if motion has stopped for 2 seconds
            const timeSinceLastMotion = Date.now() - lastMotionTimeRef.current;
            if (timeSinceLastMotion > 2000 && lastMotionTimeRef.current > 0) {
              console.log('Motion stopped - triggering analysis');
              onMotionStopped?.();
              lastMotionTimeRef.current = 0; // Reset to prevent repeated calls
            }
          }
        }

        previousFrameRef.current = currentFrame;
        requestAnimationFrame(detectMotion);
      };

      // Start motion detection
      const interval = setInterval(detectMotion, 100); // Check every 100ms

      return () => {
        clearInterval(interval);
        if (motionTimeoutRef.current) {
          clearTimeout(motionTimeoutRef.current);
        }
      };
    }, [stream, onMotionDetected, onMotionStopped, ref]);

    const calculateMotion = (frame1: ImageData, frame2: ImageData): number => {
      if (frame1.data.length !== frame2.data.length) return 0;

      let diff = 0;
      for (let i = 0; i < frame1.data.length; i += 4) {
        const r1 = frame1.data[i];
        const g1 = frame1.data[i + 1];
        const b1 = frame1.data[i + 2];
        
        const r2 = frame2.data[i];
        const g2 = frame2.data[i + 1];
        const b2 = frame2.data[i + 2];

        const pixelDiff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
        diff += pixelDiff;
      }

      return diff / (frame1.data.length / 4); // Average pixel difference
    };

    return (
      <div className="relative">
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover rounded-lg"
        />
        <canvas
          ref={canvasRef}
          className="hidden"
        />
      </div>
    );
  }
);

CameraVideo.displayName = 'CameraVideo';

export { CameraVideo };

