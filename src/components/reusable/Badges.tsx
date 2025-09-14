
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
        <div className="flex gap-2 justify-center items-center mt-3">
            <h1>Ask him about: </h1>
            <div className="flex gap-3">
                {
                    badges.map(badge => (
                        <Badge className="cursor-pointer border border-gray-600" variant="secondary" onClick={() => setSelectedPrompt(badge)}>{badge}</Badge>
                    ))
                }
            </div>
        </div>
    )
}