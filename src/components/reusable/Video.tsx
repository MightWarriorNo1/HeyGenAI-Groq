// src/components/reusable/Video.tsx
import { forwardRef } from 'react';

const Video = forwardRef<HTMLVideoElement, {}>((_, ref) => (
  <div className="w-full h-full">
    <video 
      playsInline 
      autoPlay 
      ref={ref} 
      className="w-full h-full object-cover rounded-lg lg:rounded-none"
      muted={false}
      controls={false}
    />
  </div>
));

export { Video };
