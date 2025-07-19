const promisify = require('util').promisify;
const exec = promisify(require('child_process').exec);


export interface VideoMetadata {
    title: string;
    duration: number; // in seconds
    uploader: string;
    uploadDate: string;
    viewCount: number;
    description: string;
    thumbnail: string;
}

export interface PlaylistItem {
    url: string;
    title: string;
    duration: number;
    uploader: string;
    playlist_index: number;
}

export interface PlaylistMetadata {
    title: string;
    uploader: string;
    description: string;
    itemCount: number;
}

export class QueuedAudioItem {
    public UserInputUrl: string;
    public OutputStreamUrl: string | null = null;
    public timestamp: number;
    public metadata: VideoMetadata | null = null;
    public playlistItems: PlaylistItem[] = [];
    public playlistMetadata: PlaylistMetadata | null = null;

    public static async createFromUrl(url: string, timestamp: number | null = null): Promise<QueuedAudioItem> {
        const res = new QueuedAudioItem(url, timestamp);
        if(!res.isValidUrl || !res.isYoutubeUrl) {
            console.error('Invalid YouTube URL provided.');
            return res;
        }
        if(res.isYoutubePlaylist) {
            await res.setPlaylistItems();
        } else {
            await res.setOutputStreamUrl();
            if(!res.OutputStreamUrl) {
                console.error(`Failed to set output stream URL.`);
                return res;
            }
            await res.setMetadata();
            if(!res.metadata) {
                console.error(`Failed to fetch metadata for URL: ${url}`);
                return res;
            }
        }
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
    
    public get isPlaylist(): boolean {
        return this.isYoutubePlaylist;
    }

    public get playlistItemCount(): number {
        return this.playlistItems.length;
    }
    
    public get isMetadataAvailable(): boolean {
        // Check if metadata is available
        return this.metadata !== null && Object.keys(this.metadata).length > 0;
    }
    
    public async setOutputStreamUrl(): Promise<void> {
        if(!this.isValidUrl || !this.isYoutubeUrl || this.isYoutubePlaylist) {
            console.error('Invalid URL provided. Must be a valid YouTube video URL.');
            this.OutputStreamUrl = null;
            return;
        }
        
        this.OutputStreamUrl = await QueuedAudioItem.fetchAudioStreamUrl(this.UserInputUrl);
    }

    private async setMetadata(): Promise<void> {
        if (!this.isValidUrl || !this.isYoutubeUrl || this.isYoutubePlaylist) {
            console.error('Invalid URL provided for metadata extraction.');
            return;
        }

        try {
            console.log(`Fetching metadata for: ${this.UserInputUrl}`);
            
            this.metadata = await QueuedAudioItem.fetchMetadata(this.UserInputUrl);
            
            if (!this.metadata) {
                console.error('Failed to fetch metadata.');
                return;
            }
            
            console.log(`Extracted metadata: ${this.metadata.title} (${this.formatDuration(this.metadata.duration)})`);
            
        } catch (error) {
            console.error('Error fetching metadata:', error);
        }
    }
    
    private async setPlaylistItems(): Promise<void> {
        if (!this.isValidUrl || !this.isYoutubeUrl || !this.isYoutubePlaylist) {
            console.error('Invalid playlist URL provided.');
            return;
        }

        try {
            console.log(`Fetching playlist items for: ${this.UserInputUrl}`);
            const [items, metadata] = await QueuedAudioItem.fetchPlaylistItems(this.UserInputUrl);
            
            if (items) {
                this.playlistItems = items;
                console.log(`Fetched ${items.length} items from playlist.`);
            } else {
                console.warn('No items found in the playlist.');
            }
            
            if (metadata) {
                this.playlistMetadata = metadata;
                console.log(`Playlist metadata: ${metadata.title} (${metadata.itemCount} items)`);
            } else {
                console.warn('No metadata found for the playlist.');
            }

        } catch (error) {
            console.error('Error fetching playlist items:', error);
        }
    }
    
    public formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }
    
    
    public get displayTitle(): string {
        if (this.isPlaylist && this.playlistMetadata) {
            return `${this.playlistMetadata.title} (${this.playlistItemCount} items)`;
        }
        return this.metadata?.title || 'Unknown Title';
    }

    public get displayDuration(): string {
        if (this.isPlaylist) {
            const totalSeconds = this.playlistItems.reduce((total, item) => total + item.duration, 0);
            return this.formatDuration(totalSeconds);
        }
        return this.metadata ? this.formatDuration(this.metadata.duration) : '0:00';
    }
    
    // Helper method to get individual playlist item URLs for later processing
    public getPlaylistItemUrls(): string[] {
        return this.playlistItems.map(item => item.url);
    }

    // Helper method to get a specific playlist item by index
    public getPlaylistItem(index: number): PlaylistItem | null {
        return this.playlistItems[index] || null;
    }

    public static async fetchAudioStreamUrl(url: string): Promise<string> {
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
    
    public static async fetchPlaylistItems(url: string): Promise<[PlaylistItem[] | null, PlaylistMetadata | null]> {
            // Use yt-dlp to extract playlist metadata and items in JSON format
            const command = `yt-dlp -j --flat-playlist "${url}"`;
            console.log(`Running command: ${command}`);
            
            const { stdout, stderr } = await exec(command, { timeout: 60000 }); // Longer timeout for playlists
            
            if (!stdout) {
                console.error('Failed to extract playlist items.');
                return [null, null];
            }
            
            // Split output by lines and parse each JSON object
            const lines = stdout.trim().split('\n');
            const items: PlaylistItem[] = [];
            let playlistTitle = '';
            let playlistUploader = '';
            let playlistDescription = '';
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const jsonData = JSON.parse(line);
                    
                    // First item usually contains playlist metadata
                    if (!playlistTitle && jsonData.playlist_title) {
                        playlistTitle = jsonData.playlist_title;
                        playlistUploader = jsonData.playlist_uploader || jsonData.uploader || 'Unknown';
                        playlistDescription = jsonData.playlist_description || jsonData.description || '';
                    }
                    
                    // Individual playlist items
                    if (jsonData.url && jsonData._type !== 'playlist') {
                        items.push({
                            url: jsonData.url,
                            title: jsonData.title || 'Unknown Title',
                            duration: jsonData.duration || 0,
                            uploader: jsonData.uploader || 'Unknown',
                            playlist_index: jsonData.playlist_index || items.length + 1
                        });
                    }
                } catch (parseError) {
                    console.warn('Failed to parse JSON line:', line);
                }
            }
            
            const playlistMetadata = {
                title: playlistTitle || 'Unknown Playlist',
                uploader: playlistUploader,
                description: playlistDescription,
                itemCount: items.length
            };

            return [items, playlistMetadata];
        }

    public static async fetchMetadata(url: string): Promise<VideoMetadata | null> {
        // Use yt-dlp to extract metadata in JSON format
        const command = `yt-dlp -j "${url}"`;
        console.log(`Running command: ${command}`);
        
        const { stdout, stderr } = await exec(command, { timeout: 30000 });
        
        if (!stdout) {
            console.error('Failed to extract metadata.');
            return null;
        }
        
        const jsonData = JSON.parse(stdout.trim());
        
        const metadata: VideoMetadata = {
            title: jsonData.title || 'Unknown Title',
            duration: jsonData.duration || 0,
            uploader: jsonData.uploader || 'Unknown Uploader',
            uploadDate: jsonData.upload_date || '',
            viewCount: jsonData.view_count || 0,
            description: jsonData.description || '',
            thumbnail: jsonData.thumbnail || ''
        };
        return metadata;
    }
}