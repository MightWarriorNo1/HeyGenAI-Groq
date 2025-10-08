import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, ChevronDown } from 'lucide-react';
import { getCameraDevices, CameraDevice } from '@/utils/cameraUtils';

interface CameraSelectorProps {
  onCameraSelect: (deviceId: string) => void;
  onCameraClick?: () => void;
  isOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
  isCameraActive?: boolean;
}

export const CameraSelector: React.FC<CameraSelectorProps> = ({
  onCameraSelect,
  onCameraClick,
  isOpen,
  onToggle,
  disabled = false,
  isCameraActive = false
}) => {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const loadDevices = async () => {
    setLoading(true);
    try {
      const cameraDevices = await getCameraDevices();
      setDevices(cameraDevices);
    } catch (error) {
      console.error('Error loading camera devices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && devices.length === 0) {
      loadDevices();
    }
  }, [isOpen]);

  // Close selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        onToggle();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onToggle]);

  const handleDeviceSelect = (deviceId: string) => {
    onCameraSelect(deviceId);
    onToggle();
  };

  return (
    <div className="relative" ref={selectorRef}>
      <Button
        variant="outline"
        size="icon"
        className={`h-8 w-8 sm:h-9 sm:w-9 ${
          isCameraActive 
            ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
            : disabled 
              ? 'bg-gray-500/20 border-gray-500/50 text-gray-400 cursor-not-allowed' 
              : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
        }`}
        onClick={onCameraClick || onToggle}
        disabled={disabled}
      >
        <Camera className="h-3 w-3 sm:h-4 sm:w-4" />
      </Button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg p-2 min-w-48 z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white text-sm font-medium">
              {isCameraActive ? 'Switch Camera' : 'Select Camera'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadDevices}
              disabled={loading}
              className="h-6 w-6 p-0 text-white hover:bg-white/20"
            >
              <ChevronDown className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          
          {loading ? (
            <div className="text-white text-sm text-center py-2">
              Loading cameras...
            </div>
          ) : devices.length === 0 ? (
            <div className="text-white text-sm text-center py-2">
              No cameras found
            </div>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {devices.map((device) => (
                <Button
                  key={device.deviceId}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeviceSelect(device.deviceId)}
                  className="w-full justify-start text-white hover:bg-white/20 h-8 text-xs"
                >
                  <Camera className="h-3 w-3 mr-2" />
                  {device.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
