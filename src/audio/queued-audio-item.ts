const promisify = require('util').promisify;
const exec = promisify(require('child_process').exec);

export class QueuedAudioItem {
    public UserInputUrl: string;
    public OutputStreamUrl: string | null = null;
    public timestamp: number;

    public static async createFromUrl(url: string, timestamp: number | null = null): Promise<QueuedAudioItem> {
        const res = new QueuedAudioItem(url, timestamp);
        if(!res.isValidUrl || !res.isYoutubeUrl || res.isYoutubePlaylist) {
            console.error('Invalid YouTube URL provided.');
            return res;
        }
        await res.setOutputStreamUrl();
        return res;
    }
    
    private constructor(url: string, timestamp: number | null = null) {
        this.UserInputUrl = url;
        this.timestamp = timestamp ?? Date.now();
    }
    
    public get isValidUrl(): boolean {
        // Check if the URL starts with http or https
        return this.UserInputUrl.startsWith('http://') || this.UserInputUrl.startsWith('https://');
    }
    
    public get isYoutubeUrl(): boolean {
        // Check if the URL is a valid YouTube URL
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        return youtubeRegex.test(this.UserInputUrl);
    }
    
    public get isYoutubePlaylist(): boolean {
        // Check if the URL is a valid YouTube playlist URL
        const playlistRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.*(list=)([^#\&\?]*).+$/;
        return playlistRegex.test(this.UserInputUrl);
    }
    
    public async setOutputStreamUrl(): Promise<void> {
        if(!this.isValidUrl || !this.isYoutubeUrl || this.isYoutubePlaylist) {
            console.error('Invalid URL provided. Must be a valid YouTube video URL.');
            this.OutputStreamUrl = null;
            return;
        }
        
        this.OutputStreamUrl = await this.fetchAudioStreamUrl(this.UserInputUrl);
    }

    private async fetchAudioStreamUrl(url: string): Promise<string> {
        if (!url.startsWith('http')) {
            console.error('Invalid URL provided. Must start with http or https.');
            throw new Error('Invalid URL provided. Must start with http or https.');
        }
        
        console.log(`Fetching audio stream URL for: ${url}`);

        try {
            // Use yt-dlp to fetch the audio stream URL
            const command = `yt-dlp -f bestaudio -g "${url}"`;
            console.log(`Running command: ${command}`);
            let { stdout, stderr } = await exec(command, { timeout: 30000 });

            if (!stdout) {
                console.error('Failed to extract audio stream URL.');
                throw new Error('Failed to extract audio stream URL.');
            }
            
            stdout = stdout.trim();
            console.log(`Extracted audio stream URL: ${stdout}`);
            
            // Check if the extracted URL is valid
            if (!stdout.startsWith('http')) {
                console.error('Extracted URL is not valid:', stdout);
                throw new Error('Extracted URL is not a valid HTTP URL');
            }
            
            return stdout;
        } catch (error) {
            console.error('Error in fetchAudioStreamUrl:', error);
            throw error;
        }
    }
}