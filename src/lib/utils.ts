import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Utility function to detect iPad
export function isIPad(): boolean {
  return /iPad/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Utility function to detect iOS Safari
export function isIOSSafari(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent);
}

// Utility function to detect Android devices
export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

// Utility function to detect mobile devices (both iOS and Android)
export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Utility function to detect if device needs special avatar handling
export function needsAvatarFixes(): boolean {
  return isIPad() || isAndroid() || isMobile();
}

// Utility function to handle avatar image loading with iPad-specific fixes
export function handleAvatarImageLoad(
  onLoad: () => void,
  onError: (error: Event) => void
) {
  return {
    onLoad: () => {
      console.log('Avatar image loaded successfully');
      onLoad();
    },
    onError: (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      console.log('Avatar image failed to load, showing fallback', e);
      const target = e.target as HTMLImageElement;
      if (target) {
        target.style.display = 'none';
        // Force fallback to show on iPad
        if (isIPad()) {
          const fallback = target.parentElement?.querySelector('[data-radix-avatar-fallback]') as HTMLElement;
          if (fallback) {
            fallback.style.display = 'flex';
          }
        }
      }
      onError(e.nativeEvent);
    }
  };
}