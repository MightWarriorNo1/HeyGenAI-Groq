import React, { useState, useEffect } from 'react';
import IPadAvatar from './IPadAvatar';
import { isIPad, isIOSSafari } from '@/lib/utils';

const AvatarTest: React.FC = () => {
  const [deviceInfo, setDeviceInfo] = useState({
    userAgent: '',
    platform: '',
    isIPad: false,
    isIOSSafari: false,
    isTouchDevice: false
  });

  useEffect(() => {
    setDeviceInfo({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      isIPad: isIPad(),
      isIOSSafari: isIOSSafari(),
      isTouchDevice: 'ontouchstart' in window
    });
  }, []);

  return (
    <div className="p-4 bg-gray-100 min-h-screen">
      <h2 className="text-2xl font-bold mb-4">Avatar Display Test</h2>
      
      {/* Device Information */}
      <div className="mb-6 p-4 bg-white rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-2">Device Information</h3>
        <div className="space-y-1 text-sm">
          <p><strong>User Agent:</strong> {deviceInfo.userAgent}</p>
          <p><strong>Platform:</strong> {deviceInfo.platform}</p>
          <p><strong>Is iPad:</strong> {deviceInfo.isIPad ? 'Yes' : 'No'}</p>
          <p><strong>Is iOS Safari:</strong> {deviceInfo.isIOSSafari ? 'Yes' : 'No'}</p>
          <p><strong>Is Touch Device:</strong> {deviceInfo.isTouchDevice ? 'Yes' : 'No'}</p>
        </div>
      </div>

      {/* Avatar Tests */}
      <div className="space-y-6">
        <div className="p-4 bg-white rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-3">Assistant Avatar Test</h3>
          <div className="flex items-center space-x-4">
            <IPadAvatar 
              src="https://github.com/shadcn.png" 
              alt="Assistant Avatar"
              fallback="AI"
              className="w-12 h-12"
              onLoad={() => console.log('Assistant avatar loaded successfully')}
              onError={(e) => console.log('Assistant avatar failed to load:', e)}
            />
            <div>
              <p className="text-sm text-gray-600">This should display a circular avatar image</p>
              <p className="text-xs text-gray-500">Check console for load/error messages</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-3">User Avatar Test</h3>
          <div className="flex items-center space-x-4">
            <IPadAvatar 
              src="https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg" 
              alt="User Avatar"
              fallback="U"
              className="w-12 h-12"
              onLoad={() => console.log('User avatar loaded successfully')}
              onError={(e) => console.log('User avatar failed to load:', e)}
            />
            <div>
              <p className="text-sm text-gray-600">This should display a circular avatar image</p>
              <p className="text-xs text-gray-500">Check console for load/error messages</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-3">Fallback Test (Invalid URL)</h3>
          <div className="flex items-center space-x-4">
            <IPadAvatar 
              src="https://invalid-url-that-should-fail.com/image.jpg" 
              alt="Fallback Avatar"
              fallback="FB"
              className="w-12 h-12"
              onLoad={() => console.log('Fallback avatar loaded successfully')}
              onError={(e) => console.log('Fallback avatar failed to load (expected):', e)}
            />
            <div>
              <p className="text-sm text-gray-600">This should display a circular fallback with "FB"</p>
              <p className="text-xs text-gray-500">This tests the fallback mechanism</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-3">Different Sizes Test</h3>
          <div className="flex items-center space-x-4">
            <IPadAvatar 
              src="https://github.com/shadcn.png" 
              alt="Small Avatar"
              fallback="S"
              className="w-6 h-6"
            />
            <IPadAvatar 
              src="https://github.com/shadcn.png" 
              alt="Medium Avatar"
              fallback="M"
              className="w-8 h-8"
            />
            <IPadAvatar 
              src="https://github.com/shadcn.png" 
              alt="Large Avatar"
              fallback="L"
              className="w-16 h-16"
            />
            <div>
              <p className="text-sm text-gray-600">Different sized avatars should all be circular</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvatarTest;
