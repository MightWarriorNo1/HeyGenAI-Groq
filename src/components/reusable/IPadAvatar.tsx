import React, { useEffect, useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { isIPad } from '@/lib/utils';

interface IPadAvatarProps {
  src: string;
  alt: string;
  fallback: string;
  className?: string;
  onLoad?: () => void;
  onError?: (error: Event) => void;
}

const IPadAvatar: React.FC<IPadAvatarProps> = ({
  src,
  alt,
  fallback,
  className = '',
  onLoad,
  onError
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isIPadDevice, setIsIPadDevice] = useState(false);

  useEffect(() => {
    setIsIPadDevice(isIPad());
  }, []);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
    onLoad?.();
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    console.log('Avatar image failed to load on iPad:', e);
    setImageError(true);
    setImageLoaded(false);
    
    // Force fallback display
    const target = e.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
    
    onError?.(e.nativeEvent);
  };

  // For iPad, we'll use a more robust approach
  if (isIPadDevice) {
    return (
      <Avatar className={`avatar-container ${className}`}>
        {!imageError && (
          <AvatarImage 
            src={src} 
            alt={alt}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{
              display: imageError ? 'none' : 'block'
            }}
          />
        )}
        <AvatarFallback 
          className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold"
          style={{
            display: imageError || !imageLoaded ? 'flex' : 'none'
          }}
        >
          {fallback}
        </AvatarFallback>
      </Avatar>
    );
  }

  // For non-iPad devices, use standard avatar
  return (
    <Avatar className={`avatar-container ${className}`}>
      <AvatarImage 
        src={src} 
        alt={alt}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold">
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
};

export default IPadAvatar;
