
import { Badge } from "@/components/ui/badge"
import React from "react"

const badges: string[] = [
    "Enligence AI Lab",
    "Technology",
    "Random fun facts",
    "Personal finance advice",
]
interface BadgeProps {
    setSelectedPrompt: (badge: string) => void;
}
export const Badges: React.FC<BadgeProps> = ({ setSelectedPrompt }) => {

    return (
        <div className="flex flex-col sm:flex-row gap-2 justify-center items-center mt-3 px-2">
            <h1 className="text-sm sm:text-base whitespace-nowrap text-white">Ask him about: </h1>
            <div className="flex flex-wrap gap-2 justify-center">
                {
                    badges.map((badge, index) => (
                        <Badge 
                            key={index}
                            className="cursor-pointer border border-gray-600 text-xs sm:text-sm whitespace-nowrap" 
                            variant="secondary" 
                            onClick={() => setSelectedPrompt(badge)}
                        >
                            {badge}
                        </Badge>
                    ))
                }
            </div>
        </div>
    )
}