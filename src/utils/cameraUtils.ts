export interface CameraDevice {
  deviceId: string;
  label: string;
  kind: string;
  groupId: string;
}

export const getCameraDevices = async (): Promise<CameraDevice[]> => {
  try {
    // Request permission first
    await navigator.mediaDevices.getUserMedia({ video: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(device => device.kind === 'videoinput')
      .map(device => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
        kind: device.kind,
        groupId: device.groupId
      }));
  } catch (error) {
    console.error('Error getting camera devices:', error);
    return [];
  }
};

export const getCameraStream = async (deviceId?: string): Promise<MediaStream> => {
  const constraints: MediaStreamConstraints = {
    video: deviceId 
      ? { deviceId: { exact: deviceId }, width: 320, height: 240 }
      : { width: 320, height: 240 },
    audio: false
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
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
