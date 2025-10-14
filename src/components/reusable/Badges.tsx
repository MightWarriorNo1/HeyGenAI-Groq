
import { Button } from "@/components/ui/button"
import React, { useRef } from "react"
import { Paperclip, Camera } from "lucide-react"

const defaultBadges: string[] = [
    "🤔 Mind-Bending Mysteries",
    "💰 Money Magic & Mayhem", 
    "💕 Love & Laughter Therapy",
    "🎭 Life's Comedy Coach"
]

interface BadgeProps {
    setSelectedPrompt: (badge: string) => void;
    onFileUpload?: (file: File) => void;
    onCameraClick?: () => void;
    isCameraActive?: boolean;
    dynamicButtons?: string[];
    hasMediaContext?: boolean;
    mediaFileName?: string;
}

export const Badges: React.FC<BadgeProps> = ({ setSelectedPrompt, onFileUpload, onCameraClick, isCameraActive, dynamicButtons, hasMediaContext, mediaFileName }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && onFileUpload) {
            onFileUpload(file);
        }
    };

    const handlePaperclipClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="flex flex-col items-center gap-4 mt-3 px-2 w-full">
            {/* Media context indicator */}
            {hasMediaContext && (
                <div className="bg-green-500/20 border border-green-500/50 text-green-400 px-3 py-2 rounded-lg text-sm">
                    📎 Analyzing: {mediaFileName}
                </div>
            )}
            
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.avi,.mkv,.webm"
                onChange={handleFileUpload}
                className="hidden"
            />
            
            {/* Icon buttons row */}
            <div className="flex gap-2 sm:gap-3">
                <Button
                    variant="outline"
                    size="icon"
                    className={`h-10 w-14 sm:h-10 sm:w-14 ${
                        isCameraActive 
                            ? 'bg-red-500/20 border-red-500/50 text-red-400 rounded-full hover:bg-red-500/30' 
                            : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                    }`}
                    onClick={onCameraClick}
                >
                    <Camera className="h-6 w-6 sm:h-8 sm:w-8" />
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-10 w-14 sm:h-10 sm:w-14"
                    onClick={handlePaperclipClick}
                >
                    <Paperclip className="h-6 w-6 sm:h-8 sm:w-8" />
                </Button>
                
            </div>
            
            {/* Main buttons - responsive layout */}
            <div className="w-full max-w-4xl">
                {/* Mobile: 2x2 grid, Desktop: 3+1 layout */}
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
            </div>
        </div>
    )
}