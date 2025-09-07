import { PlaylistItem } from "./playlist-item";

const promisify = require('util').promisify;
const exec = promisify(require('child_process').exec);
const fs = require('fs');
import { execFile } from "child_process";

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
                //const newItem = await QueuedAudioItem.fetchMetadata(url, user);
                const newItem = await QueuedAudioItem.fetchMetadataAndAudioUrl(url, user);
                if (newItem) {
                    res.push(newItem);
                } else {
                    console.warn('No metadata found for the video.');
                }
            } catch (error) {
                console.error('Error fetching metadata:', error);
                throw error;
            }
        }
        // try {
        //     console.log(`Fetching media items for: ${url}`);
        //     const [items, fetchedPlaylist] = await QueuedAudioItem.fetchMediaList(url, user);

        //     if (items && items.length > 0) {
        //         if (fetchedPlaylist) {
        //             res.push(...items);
        //             playlistItem = fetchedPlaylist;
        //             console.log(`Fetched ${items.length} items from playlist.`);
        //         } else if (items.length === 1) {
        //             res.push(...items);
        //             console.log(`Fetched single video item.`);
        //         }
        //     } else {
        //         console.warn('No items found in the playlist or missing metadata.');
        //     }
        // } catch (error) {
        //     console.error('Error fetching playlist items:', error);
        //     throw error;
        // }
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
    
    public setOutputStreamUrlDirectly(url: string): void {
        this.outputStreamUrl = url;
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
            
            const { stdout, stderr } = await exec(command, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }); // Longer timeout for playlists
            
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

    public static async fetchMetadataAndAudioUrl(url: string, user: string): Promise<QueuedAudioItem | null> {
        if (!/^https?:\/\//i.test(url)) {
            throw new Error("Invalid URL provided. Must start with http or https.");
        }

        // Single yt-dlp call that prints one JSON object
        const command = [
          'yt-dlp',
          '-f', 'bestaudio',
          '-S', 'proto:https',
          '--no-playlist',
          '--no-warnings',
          '--print',
          // JSON template (newlines allowed; shell treats it as one arg)
          `'{"title": %(title)j, "duration": %(duration)j, "uploader": %(uploader)j, "upload_date": %(upload_date)j, "view_count": %(view_count)j, "description": %(description)j, "thumbnail": %(thumbnail)j, "id": %(id)j, "webpage_url": %(webpage_url)j, "audio_url": %(url)j}'`,
          `"${url}"`
        ].join(' ');
        console.log(`Running YT-DLP command: ${command}`);
        
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
        
        if(jsonData.audio_url && typeof jsonData.audio_url === 'string' && jsonData.audio_url.startsWith('http')) {
            console.log(` + Extracted audio stream URL: ${jsonData.audio_url}`);
            newItem.setOutputStreamUrlDirectly(jsonData.audio_url || null);
        } else {
            console.warn(' + No valid audio URL found in metadata.');
            return null;
        }

        return newItem;
    }
    

    public static fetchMediaList(url: string, user: string): Promise<[QueuedAudioItem[], PlaylistItem | null]> {
        if (!/^https?:\/\//i.test(url)) {
            return Promise.reject(new Error("URL must start with http or https."));
        }

        // Single template for both single video and playlist entries
        const template =
            '{"title": %(title)j, "duration": %(duration)j, "uploader": %(uploader)j, "upload_date": %(upload_date)j, "view_count": %(view_count)j, "description": %(description)j, "thumbnail": %(thumbnail)j, "id": %(id)j, "webpage_url": %(webpage_url)j, "audio_url": %(url)j, , "playlist_title": %(playlist_title)j, "playlist_id": %(playlist_id)j, "playlist_description": %(playlist_description)j, "playlist_index": %(playlist_index)j, "playlist_uploader": %(playlist_uploader)j}';

        const args = [
            "-f", "bestaudio",
            "-S", "proto:https",
            "--yes-playlist",          // single URL -> 1 line; playlist -> many lines
            "--no-warnings",
            "--print", template,
            url
        ];

        let playlistTitle = '';
        let playlistUploader = '';
        let playlistDescription = '';
        let playlistId = '';
        let playlistDuration = 0;

        return new Promise<[QueuedAudioItem[], PlaylistItem | null]>((resolve, reject) => {
            execFile("yt-dlp", args, { maxBuffer: 24 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
                if (err) return reject(err);
                const items: QueuedAudioItem[] = [];

                for (const line of stdout.split(/\r?\n/)) {
                    const t = line.trim();
                    if (!t) continue;
                    try {
                        const obj = JSON.parse(t);
                        if (!playlistTitle && obj.playlist_title
                            && !playlistId && obj.playlist_id
                        ) {
                            playlistId = obj.playlist_id || '';
                            playlistTitle = obj.playlist_title;
                            playlistUploader = obj.playlist_uploader || obj.uploader || 'Unknown';
                            playlistDescription = obj.playlist_description || obj.description || '';
                        }
                        if (obj.audio_url?.startsWith("http")) {
                            const newItem = new QueuedAudioItem(
                                url,
                                user,
                                obj.title || 'Unknown Title',
                                obj.duration || 0,
                                obj.uploader || 'Unknown',
                                obj.upload_date || '',
                                obj.view_count || 0,
                                obj.description || '',
                                Date.now(),
                                obj.thumbnail || ''
                            );
                            newItem.setOutputStreamUrlDirectly(obj.audio_url);
                            items.push(newItem);
                        }
                    } catch { /* ignore malformed lines */ }
                }
                if (!items.length) return reject(new Error(stderr || "No items found."));

                if(items.length === 1 && !playlistId) {
                    resolve([items, null]);
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
                resolve([items, playlistItem]);
            });
        });
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