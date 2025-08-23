import { PlaylistItem } from "./playlist-item";

const promisify = require('util').promisify;
const exec = promisify(require('child_process').exec);
const fs = require('fs');

export class QueuedAudioItem {
    public userInputUrl: string;
    public outputStreamUrl: string | null = null;
    public timestamp: number;
    public user: string;
    public title: string;
    public duration: number; // in seconds
    public uploader: string;
    public uploadDate: string;
    public viewCount: number;
    public description: string;
    public thumbnail: string | null;
    public playlistId: string | null = null;
    public playlistIndex: number = -1;

    public static async createFromUrl(url: string, user: string, timestamp: number | null = Date.now()): Promise<[QueuedAudioItem[], PlaylistItem | null]> {
        const res: QueuedAudioItem[] = [];
        let playlistItem: PlaylistItem | null = null;
        if(!QueuedAudioItem.isValidUrl(url) || !QueuedAudioItem.isYoutubeUrl(url)) {
            console.error('Invalid YouTube URL provided.');
            throw new Error('Invalid YouTube URL');
        }
        if(QueuedAudioItem.isYoutubePlaylist(url)) {
            try {
                console.log(`Fetching playlist items for: ${url}`);
                const [items, fetchedPlaylist] = await QueuedAudioItem.fetchPlaylistItems(url, user);

                if (items && items.length > 0 && fetchedPlaylist) {
                    res.push(...items);
                    playlistItem = fetchedPlaylist;
                    console.log(`Fetched ${items.length} items from playlist.`);
                } else {
                    console.warn('No items found in the playlist or missing metadata.');
                }

            } catch (error) {
                console.error('Error fetching playlist items:', error);
            }
        } else {
            try {
                const newItem = await QueuedAudioItem.fetchMetadata(url, user);
                if (newItem) {
                    res.push(newItem);
                } else {
                    console.warn('No metadata found for the video.');
                }
            } catch (error) {
                console.error('Error fetching metadata:', error);
            }
        }
        return [res, playlistItem];
    }
    
    private constructor(
        inputUrl: string,
        user: string,
        title: string,
        duration: number,
        uploader: string,
        uploadDate: string,
        viewCount: number,
        description: string,
        timestamp: number | null = null,
        thumbnail: string | null = null
    ) {
        this.userInputUrl = inputUrl;
        this.user = user;
        this.title = title;
        this.duration = duration;
        this.uploader = uploader;
        this.uploadDate = uploadDate;
        this.viewCount = viewCount;
        this.description = description;
        this.timestamp = timestamp ?? Date.now();
        this.thumbnail = thumbnail;
    }

    public get isValidUrl(): boolean {
        return QueuedAudioItem.isValidUrl(this.userInputUrl);
    }
    
    public get isYoutubeUrl(): boolean {
        return QueuedAudioItem.isYoutubeUrl(this.userInputUrl);
    }
    
    public get isYoutubePlaylist(): boolean {
        return QueuedAudioItem.isYoutubePlaylist(this.userInputUrl);
    }
    public get isOutputUrlSet(): boolean {
        return this.outputStreamUrl !== null;
    }
    
    public async setOutputStreamUrl(): Promise<void> {
        if(!this.isValidUrl || !this.isYoutubeUrl || this.isYoutubePlaylist) {
            console.error('Invalid URL provided. Must be a valid YouTube video URL.');
            console.debug('Invalid URL:', this.userInputUrl);
            console.debug('Is Valid URL: ', this.isValidUrl);
            console.debug('Is Valid YouTube URL: ', this.isYoutubeUrl);
            console.debug('Is Valid YouTube Playlist: ', this.isYoutubePlaylist);
            this.outputStreamUrl = null;
            return;
        }

        if(this.isOutputUrlSet) {
            console.log(`Output stream URL is already set for: ${this.userInputUrl}`);
            return;
        }

        this.outputStreamUrl = await QueuedAudioItem.fetchAudioStreamUrl(this.userInputUrl);
    }

    public get displayDuration(): string {
        return QueuedAudioItem.formatDuration(this.duration);
    }

    public static async fetchAudioStreamUrl(url: string): Promise<string> {
        if (!url.startsWith('http')) {
            console.error('Invalid URL provided. Must start with http or https.');
            throw new Error('Invalid URL provided. Must start with http or https.');
        }
        
        console.log(`Fetching audio stream URL for: ${url}`);

        try {
            // Use yt-dlp to fetch the audio stream URL
            const command = `yt-dlp -f bestaudio -g "${url}" -S proto:https`;
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

    public static async fetchPlaylistItems(url: string, user: string): Promise<[QueuedAudioItem[] | null, PlaylistItem | null]> {
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
            const items: QueuedAudioItem[] = [];
            let playlistTitle = '';
            let playlistUploader = '';
            let playlistDescription = '';
            let playlistId = '';
            let playlistDuration = 0;
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const jsonData = JSON.parse(line);
                    
                    if (!playlistTitle && jsonData.playlist_title
                        && !playlistId && jsonData.playlist_id
                    ) {
                        playlistId = jsonData.playlist_id || '';
                        playlistTitle = jsonData.playlist_title;
                        playlistUploader = jsonData.playlist_uploader || jsonData.uploader || 'Unknown';
                        playlistDescription = jsonData.playlist_description || jsonData.description || '';
                    }
                    
                    // Individual playlist items
                    if (jsonData.url && jsonData._type !== 'playlist') {
                        const newItem = new QueuedAudioItem(
                            jsonData.url,
                            user,
                            jsonData.title || 'Unknown Title',
                            jsonData.duration || 0,
                            jsonData.uploader || 'Unknown',
                            jsonData.upload_date || '',
                            jsonData.view_count || 0,
                            jsonData.description || '',
                            Date.now(),
                        );
                        newItem.playlistId = playlistId;
                        newItem.playlistIndex = jsonData.playlist_index || items.length + 1
                        playlistDuration += newItem.duration;
                        items.push(newItem);
                    }
                } catch (parseError) {
                    console.warn('Failed to parse JSON line:', line);
                }
            }
            
            const playlistItem: PlaylistItem = new PlaylistItem(
                playlistId,
                url,
                playlistTitle || 'Unknown Playlist',
                playlistDescription,
                playlistDuration,
                playlistUploader,
                user,
                items.length,
                Date.now(),
            );


            return [items, playlistItem];
        }

    public static async fetchMetadata(url: string, user: string): Promise<QueuedAudioItem | null> {
        // Use yt-dlp to extract metadata in JSON format
        const command = `yt-dlp -j "${url}"`;
        console.log(`Running command: ${command}`);
        
        const { stdout, stderr } = await exec(command, { timeout: 30000 });
        
        if (!stdout) {
            console.error('Failed to extract metadata.');
            return null;
        }

        const jsonData = JSON.parse(stdout.trim());

        const newItem = new QueuedAudioItem(
            url,
            user,
            jsonData.title || 'Unknown Title',
            jsonData.duration || 0,
            jsonData.uploader || 'Unknown',
            jsonData.upload_date || '',
            jsonData.view_count || 0,
            jsonData.description || '',
            Date.now(),
            jsonData.thumbnail || ''
        );

        return newItem;
    }
    
    public static isValidUrl(url: string): boolean {
        // Use a regular expression to validate the URL format
        const urlRegex = /^(https?:\/\/)?([\w\-]+\.)+[\w\-]+(\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/;
        return urlRegex.test(url);
    }

    public static isYoutubeUrl(url: string): boolean {
        // Check if the URL is a valid YouTube URL
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        return youtubeRegex.test(url);
    }

    public static isYoutubePlaylist(url: string): boolean {
        // Check if the URL is a valid YouTube playlist URL
        const playlistRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.*(list=)([^#\&\?]*).+$/;
        return playlistRegex.test(url);
    }
    
    public static formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }
}