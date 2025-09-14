import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react"

interface LandingPageProps {
    grab: () => void;
    startLoading: boolean;
}

export const LandingComponent = ({ grab, startLoading }: LandingPageProps) => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <Card className="max-w-lg w-full p-6 shadow-lg">
                <CardHeader>
                    <CardTitle className="text-2xl font-bold text-center">
                        Welcome, To the Project
                    </CardTitle>
                    <CardDescription className='text-justify'>
                        This project is an interactive experience between the user and a real-time avatar,
                        using Hygen's highly capable avatar and OpenAI's LLM. The project converts the user's
                        speech to text via OpenAI's GPT-3.5-turbo, fetches an appropriate response using the
                        OpenAI APIs, and delivers the conversation to Hygen's avatar for a face-to-face,
                        real-time interaction. Experience it by one click down below
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center mt-4">
                    <Button onClick={grab} className="bg-blue-600 hover:bg-blue-500 text-white" disabled={startLoading}>
                        {
                            startLoading && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )
                        }
                        Get Started
                    </Button>
                    
                </CardContent>
            </Card>
        </div>
    );
};
