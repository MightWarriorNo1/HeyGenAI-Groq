import React, { useEffect, useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { isIPad, isAndroid, isMobile, needsAvatarFixes } from '@/lib/utils';

interface MobileAvatarProps {
  src: string;
  alt: string;
  fallback: string;
  className?: string;
  onLoad?: () => void;
  onError?: (error: Event) => void;
}

const MobileAvatar: React.FC<MobileAvatarProps> = ({
  src,
  alt,
  fallback,
  className = '',
  onLoad,
  onError
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState({
    isIPad: false,
    isAndroid: false,
    isMobile: false,
    needsFixes: false
  });

  useEffect(() => {
    setDeviceInfo({
      isIPad: isIPad(),
      isAndroid: isAndroid(),
      isMobile: isMobile(),
      needsFixes: needsAvatarFixes()
    });
  }, []);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
    onLoad?.();
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    console.log('Avatar image failed to load:', e);
    setImageError(true);
    setImageLoaded(false);
    
    // Force fallback display
    const target = e.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
    
    onError?.(e.nativeEvent);
  };

  // For devices that need special handling (iPad, Android, mobile)
  if (deviceInfo.needsFixes) {
    return (
      <Avatar className={`avatar-container mobile-avatar ${className}`}>
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

  // For desktop devices, use standard avatar
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

export default MobileAvatar;
