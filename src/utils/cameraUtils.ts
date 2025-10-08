export interface CameraDevice {
  deviceId: string;
  label: string;
  kind: string;
  groupId: string;
}

export const getCameraDevices = async (): Promise<CameraDevice[]> => {
  try {
    // First, try to get a temporary stream to ensure permissions are granted
    // This is required for device labels to be populated
    const tempStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user' } // Start with front camera
    });
    
    // Stop the temporary stream
    tempStream.getTracks().forEach(track => track.stop());
    
    // Now enumerate devices with proper labels
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices
      .filter(device => device.kind === 'videoinput')
      .map((device, index) => {
        let label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
        
        // Try to identify front vs back camera based on label
        if (label.toLowerCase().includes('front') || label.toLowerCase().includes('user')) {
          label = '📱 Front Camera';
        } else if (label.toLowerCase().includes('back') || label.toLowerCase().includes('environment')) {
          label = '📷 Back Camera';
        } else if (index === 0) {
          label = '📱 Front Camera';
        } else if (index === 1) {
          label = '📷 Back Camera';
        } else {
          label = `📷 Camera ${index + 1}`;
        }
        
        return {
          deviceId: device.deviceId,
          label: label,
          kind: device.kind,
          groupId: device.groupId
        };
      });
    
    console.log('Found camera devices:', videoDevices);
    return videoDevices;
  } catch (error) {
    console.error('Error getting camera devices:', error);
    // Fallback: try to enumerate without permission
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
          kind: device.kind,
          groupId: device.groupId
        }));
    } catch (fallbackError) {
      console.error('Fallback device enumeration failed:', fallbackError);
      return [];
    }
  }
};

export const getCameraStream = async (deviceId?: string): Promise<MediaStream> => {
  let constraints: MediaStreamConstraints;
  
  if (deviceId) {
    // Use specific device
    constraints = {
      video: { 
        deviceId: { exact: deviceId }, 
        width: { ideal: 640 }, 
        height: { ideal: 480 },
        facingMode: deviceId.includes('back') ? 'environment' : 'user'
      },
      audio: false
    };
  } else {
    // Default to front camera
    constraints = {
      video: { 
        facingMode: 'user',
        width: { ideal: 640 }, 
        height: { ideal: 480 }
      },
      audio: false
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('Camera stream obtained:', stream.getVideoTracks().length, 'video tracks');
    return stream;
  } catch (error) {
    console.error('Error accessing camera:', error);
    throw error;
  }
};

export const getCameraError = (error: any): string => {
  if (error.name === 'NotAllowedError') {
    return 'Camera permission denied. Please allow camera access and try again.';
  } else if (error.name === 'NotFoundError') {
    return 'No camera found. Please connect a camera and try again.';
  } else if (error.name === 'NotReadableError') {
    return 'Camera is already in use by another application.';
  } else if (error.name === 'OverconstrainedError') {
    return 'Camera constraints cannot be satisfied.';
  } else {
    return 'Failed to access camera. Please check your camera and try again.';
  }
};

