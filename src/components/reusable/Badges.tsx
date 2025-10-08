
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
}

export const Badges: React.FC<BadgeProps> = ({ setSelectedPrompt, onFileUpload, onCameraClick, isCameraActive, dynamicButtons }) => {
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
                    className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-8 w-8 sm:h-9 sm:w-9"
                    onClick={handlePaperclipClick}
                >
                    <Paperclip className="h-3 w-3 sm:h-4 sm:w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    className={`h-8 w-8 sm:h-9 sm:w-9 ${
                        isCameraActive 
                            ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
                            : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                    }`}
                    onClick={onCameraClick}
                >
                    <Camera className="h-3 w-3 sm:h-4 sm:w-4" />
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