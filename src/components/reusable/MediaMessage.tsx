import { useState, useEffect } from 'react';

interface MediaMessageProps {
  file: File;
  type: 'photo' | 'video';
  role: 'user' | 'assistant';
}

const MediaMessage = ({ file, type, role }: MediaMessageProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!imageUrl) return null;

  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-[85%] sm:max-w-xs rounded-lg overflow-hidden ${
        role === 'user' 
          ? 'bg-blue-500 text-white' 
          : 'bg-gray-200 text-gray-800'
      }`}>
        {type === 'photo' ? (
          <img
            src={imageUrl}
            alt="Captured photo"
            className="w-full h-auto max-h-48 sm:max-h-64 object-cover"
          />
        ) : (
          <video
            src={imageUrl}
            controls
            className="w-full h-auto max-h-48 sm:max-h-64"
          />
        )}
        <div className="p-2 text-xs">
          <p className="font-medium truncate">{file.name}</p>
          <p className="opacity-75">
            {type === 'photo' ? 'Photo' : 'Video'} • {Math.round(file.size / 1024)}KB
          </p>
        </div>
      </div>
    </div>
  );
};

export default MediaMessage;
