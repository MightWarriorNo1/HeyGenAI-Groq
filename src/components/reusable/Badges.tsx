
import React from "react"
import { Paperclip } from "lucide-react"

interface BadgeProps {
    setSelectedPrompt: (badge: string) => void;
    onFileUpload?: (file: File) => void;
    onCameraClick?: () => void;
    isCameraActive?: boolean;
    dynamicButtons?: string[];
    hasMediaContext?: boolean;
    mediaFileName?: string;
    onClearContext?: () => void;
}

export const Badges: React.FC<BadgeProps> = ({ hasMediaContext, onClearContext }) => {

    return (
        <div className="flex flex-col items-center gap-4 mt-3 px-2 w-full">
            {/* Enhanced media context indicator */}
            {hasMediaContext && (
                <div className="bg-green-500/20 border border-green-500/50 text-green-400 px-4 py-3 rounded-lg text-sm max-w-md w-full text-center shadow-lg">
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <Paperclip className="h-4 w-4 animate-pulse" />
                        <span className="font-semibold">Ready to discuss!</span>
                    </div>
                    <div className="text-xs mt-1 opacity-70">
                        Ask me anything about this file
                    </div>
                    {onClearContext && (
                        <button
                            onClick={onClearContext}
                            className="mt-2 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 px-2 py-1 rounded transition-colors"
                        >
                            Clear context
                        </button>
                    )}
                </div>
            )}
            
            
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