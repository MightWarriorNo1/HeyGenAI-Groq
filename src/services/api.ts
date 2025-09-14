import axios from 'axios';


export const getAccessToken = async ():Promise<any> => {
    try {
        const response = await axios.post('https://api.heygen.com/v1/streaming.create_token', {}, {
            headers: {
                'x-api-key': import.meta.env.VITE_HEYGEN_API_KEY
            }
        });
        if(response) {
            return response;
        }
    } catch(err) {
        throw err;
    }
}