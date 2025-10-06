// src/components/reusable/Video.tsx
import { forwardRef } from 'react';

const Video = forwardRef<HTMLVideoElement, object>((_, ref) => (
  <video 
    playsInline 
    autoPlay 
    loop
    ref={ref} 
    className="w-full h-full object-cover" 
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
  />
));

export { Video };
