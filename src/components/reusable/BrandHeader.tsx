import React from 'react';

const BrandHeader: React.FC = () => {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex justify-center items-center
    ">
      <div className="px-6 py-3 text-center">
        <div className="text-2xl sm:text-3xl font-serif text-white" style={{ fontFamily: 'Bell MT, serif' }}>
          iSolveUrProblems - beta
        </div>
        <div className="text-sm sm:text-base font-serif mt-1 text-white" style={{ fontFamily: 'Bell MT, serif' }}>
          Everything, except Murder
        </div>
      </div>
    </div>
  );
};

export default BrandHeader;
