// src/components/reusable/Video.tsx
import { forwardRef } from 'react';

const Video = forwardRef<HTMLVideoElement, {}>((_, ref) => (
  <div className="w-full">
    <video playsInline autoPlay width={500} ref={ref} className="rounded-lg w-full h-full"  />
  </div>
));

export { Video };
