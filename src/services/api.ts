import axios from 'axios';


export const getAccessToken = async ():Promise<any> => {
    try {
        // Use relative path for production, absolute for development
        const apiUrl = import.meta.env.DEV 
            ? 'https://api.heygen.com/v1/streaming.create_token'
            : '/api/heygen/v1/streaming.create_token';
            
        const response = await axios.post(apiUrl, {}, {
            headers: {
                'x-api-key': import.meta.env.VITE_HEYGEN_API_KEY
            }
        });
        if(response) {
            return response;
        }
    } catch(err) {
        console.error('Error getting access token:', err);
        throw err;
    }
}