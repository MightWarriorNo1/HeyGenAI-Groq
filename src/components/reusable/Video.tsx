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
    onLoadedMetadata={() => {
      // Set volume to maximum when video loads
      if (ref && typeof ref !== 'function' && ref.current) {
        ref.current.volume = 1.0;
        ref.current.muted = false;
        
        // Set up audio amplification for louder volume
        try {
          const audioContext = new (window.AudioContext)();
          const gainNode = audioContext.createGain();
          gainNode.gain.value = 2.0; // Double the volume
          
          const source = audioContext.createMediaElementSource(ref.current);
          source.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          console.log('Video audio amplification set up with 2x volume boost');
        } catch (error) {
          console.error('Error setting up video audio amplification:', error);
        }
      }
    }}
  />
));

export { Video };
