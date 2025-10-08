// src/components/reusable/Video.tsx
import { forwardRef } from 'react';

const Video = forwardRef<HTMLVideoElement, object>((_, ref) => (
  <video 
    playsInline 
    autoPlay 
    loop
    ref={ref} 
    className="w-full h-full object-cover transition-all duration-500 ease-in-out" 
    style={{ 
      backgroundColor: '#000',
      minHeight: '100vh',
      minWidth: '100vw'
    }}
    onError={(e) => {
      console.error('Video error:', e);
    }}
    onLoadStart={() => {
      console.log('Video loading started');
    }}
    onCanPlay={() => {
      console.log('Video can play');
    }}
    onLoadedMetadata={() => {
      // Set volume to maximum when video loads
      if (ref && typeof ref !== 'function' && ref.current) {
        ref.current.volume = 1.0;
        ref.current.muted = false;
      }
    }}
  />
));

export { Video };
