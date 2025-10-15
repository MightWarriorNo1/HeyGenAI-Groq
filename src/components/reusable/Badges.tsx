
import React from "react"

interface BadgeProps {
    setSelectedPrompt: (badge: string) => void;
    onFileUpload?: (file: File) => void;
    onCameraClick?: () => void;
    isCameraActive?: boolean;
    hasMediaContext?: boolean;
    mediaFileName?: string;
    onClearContext?: () => void;
}

export const Badges: React.FC<BadgeProps> = () => {

    return (
        <div className="flex flex-col items-center gap-4 mt-3 px-2 w-full">
            {/* Enhanced media context indicator */}
            
            
            {/* Main buttons - responsive layout */}
            {/* <div className="w-full max-w-4xl">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 w-full">
                    {(dynamicButtons && dynamicButtons.length > 0 ? dynamicButtons : defaultBadges).map((badge, index) => (
                        <Button
                            key={index}
                            variant="outline"
                            className="bg-white/10 border-white/20 text-white hover:bg-white/20 px-2 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm whitespace-nowrap w-full"
                            onClick={() => setSelectedPrompt(badge)}
                        >
                            {badge}
                        </Button>
                    ))}
                </div>
            </div> */}
        </div>
    )
}