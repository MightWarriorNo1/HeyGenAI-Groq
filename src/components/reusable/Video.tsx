// src/components/reusable/Video.tsx
import { forwardRef } from 'react';

const Video = forwardRef<HTMLVideoElement, {}>((_, ref) => (
  <video 
    playsInline 
    autoPlay 
    ref={ref} 
    className="w-full h-full object-cover" 
  />
));

export { Video };
