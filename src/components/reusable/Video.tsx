// src/components/reusable/Video.tsx
import { forwardRef } from 'react';

interface VideoProps {
  className?: string;
}

const Video = forwardRef<HTMLVideoElement, VideoProps>(({ className = "" }, ref) => (
  <div className="w-full h-full">
    <video 
      playsInline 
      autoPlay 
      ref={ref} 
      className={`w-full h-full object-cover rounded-lg lg:rounded-none ${className}`}
      muted={false}
      controls={false}
    />
  </div>
));

export { Video };
