import { VoiceBasedChannel, VoiceConnectionStates } from "discord.js";
import { AudioPlayer, AudioPlayerState, AudioPlayerStatus, AudioResource, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, VoiceConnection, VoiceConnectionDisconnectReason, VoiceConnectionState} from "@discordjs/voice";
import { QueuedAudioItem } from "./queued-audio-item";
import { PlaylistItem } from "./playlist-item";
const { spawn } = require('child_process');

enum TimeoutType {
    IDLE = 'idle',
    PAUSE = 'pause'
}

export class ChannelAudioPlayer {
    public player: AudioPlayer | null = null;
    public playlistItems: PlaylistItem[] = [];
    public playQueue: QueuedAudioItem[] = [];
    public currentItem: QueuedAudioItem | null = null;
    public messageOutCallback: ((message: string) => void) | null = null;
    
    // Timeout management
    private currentTimeout: NodeJS.Timeout | null = null;
    private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    private readonly PAUSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    
    constructor(
        public guildId: string,
        public connection: VoiceConnection,
        public channel: VoiceBasedChannel,
        public closeConnectionCallback?: (source: ChannelAudioPlayer | null) => void,
        messageOutCallback?: (message: string) => void
    ) {
        this.connection = connection;
        this.channel = channel;
        this.messageOutCallback = messageOutCallback || null;
        
        this.connection.on('stateChange', (oldState, newState) => this.onVoiceStatusChange(oldState, newState));
        this.connection.on('error', (error) => this.onVoiceError(error));

        this.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
            },
        });
        
        this.player.on('stateChange', (oldState, newState) => this.onAudioStatusChange(oldState, newState));
        this.player.on('error', (error) => this.onAudioError(error));
        
        const subscriber = connection.subscribe(this.player);
        if (!subscriber) {
            console.error('Failed to subscribe to audio player.');
            this.closeConnectionCallback?.(this);
            return;
        }

        console.log(`Audio player initialized for channel ${channel.id}`);
    }
    
    public get audioPlayerStatus(): AudioPlayerStatus {
        return this.player?.state.status || AudioPlayerStatus.Idle;
    }
    
    public get voiceConnectionStatus() {
        return this.connection.state.status || VoiceConnectionStates.Disconnected;
    }

    public get currentAudioItem(): [QueuedAudioItem | null, PlaylistItem | null] {
        return [this.currentItem, this.playlistItems.find(item => item.playlistId === this.currentItem?.playlistId) || null];
    }

    public get isCurrentItemPlaylist(): boolean {
        const playlist = this.playlistItems.find(item => item.playlistId === this.currentItem?.playlistId);
        return playlist !== undefined;
    }

    public get currentPlaylistItem(): PlaylistItem | null {
        return this.playlistItems.find(item => item.playlistId === this.currentItem?.playlistId) || null;
    }
    
    public get remainingPlaylistCount(): number {
        const playlist: PlaylistItem | null = this.currentPlaylistItem;
        return this.playQueue.filter(item => item.playlistId === playlist?.playlistId).length || 0;
    }

    /**
     * Handles changes in the audio player state
     * @param oldState The previous state of the audio player
     * @param newState The new state of the audio player
     */
    private async onAudioStatusChange(oldState: AudioPlayerState, newState: AudioPlayerState): Promise<void> {
        console.log(`Audio player status changed for channel ${this.channel.id}: ${oldState.status} -> ${newState.status}`);
        this.handleStatusChange(newState.status);
        await this.checkAndUpdatePlayerState();
    }

    
    /**
     * Handles changes in the voice connection state
     * @param oldState The previous state of the voice connection
     * @param newState The new state of the voice connection
     * @throws Error if the connection is not ready or if the player is not initialized
     */
    private async onVoiceStatusChange(oldState: VoiceConnectionState, newState: VoiceConnectionState): Promise<void> {
        if (newState.status === 'disconnected' || newState.status === 'destroyed') {
            console.log(`Connection state changed for channel ${this.channel.id}: ${oldState.status} -> ${newState.status}`);
            this.closeConnectionCallback?.(this);
        }
        await this.checkAndUpdatePlayerState();
    }
    
    /**
     * Handles errors that occur in the audio player
     * @param error The error that occurred in the audio player
     */
    private async onAudioError(error: Error): Promise<void> {
        console.error(`Error occurred in audio player for channel ${this.channel.id}:`, error);
        this.messageOutCallback?.(`❗ An error occurred in the audio player: ${error.message}`);
        this.closeConnectionCallback?.(this);
    }
    
    /**
     * Handles errors that occur in the voice connection
     * @param error The error that occurred in the voice connection
     */
    private async onVoiceError(error: Error): Promise<void> {
        console.error(`Error occurred in voice connection for channel ${this.channel.id}:`, error);
        this.messageOutCallback?.(`❗ An error occurred in the voice connection: ${error.message}`);
        this.closeConnectionCallback?.(this);
    }
    
    /**
     * Clears any existing timeout and sets a new one based on the timeout type
     */
    private setInactivityTimeout(type: TimeoutType): void {
        this.clearInactivityTimeout();
        
        const timeoutMs = type === TimeoutType.IDLE ? this.IDLE_TIMEOUT_MS : this.PAUSE_TIMEOUT_MS;
        const action = type === TimeoutType.IDLE ? 'idle' : 'paused';
        
        if(type === TimeoutType.IDLE) {
            this.currentItem = null;
        }
        
        this.currentTimeout = setTimeout(() => {
            console.log(`Disconnecting from channel ${this.channel.id} due to ${action} timeout.`);
            this.messageOutCallback?.(`⏹️ Audio ${action} for ${timeoutMs / 60000} minutes. Disconnecting...`);
            this.closeConnectionCallback?.(this);
        }, timeoutMs);
        
        console.log(`Set ${action} timeout for channel ${this.channel.id} (${timeoutMs / 60000} minutes)`);
    }
    
    /**
     * Clears the current inactivity timeout if one exists
     */
    private clearInactivityTimeout(): void {
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
            console.log(`Cleared inactivity timeout for channel ${this.channel.id}`);
        }
    }

    public async addItemsToQueue(items: QueuedAudioItem[], playlist: PlaylistItem | null): Promise<void> {
        if(playlist) {
            this.playlistItems.push(playlist);
            console.log(`Added playlist to queue for channel ${this.channel.id}: ${playlist.title}`);
        }

        for(const item of items) {
            this.playQueue.push(item);
            console.log(`Added item to queue for channel ${this.channel.id}: ${item.userInputUrl}`);
        }    
        await this.checkAndUpdatePlayerState();
    }
    
    /**
     * Adds an audio item to the play queue and checks the player state to start playback if necessary 
     * @param item The audio item to add to the queue
     * @throws Error if the URL is invalid or if the audio player is not initialized
     */
    public async addToQueue(item: QueuedAudioItem, playlist: PlaylistItem | null): Promise<void> {
        if (!item.isValidUrl) {
            console.error('Invalid URL provided. Cannot add to queue.');
            throw new Error('Invalid URL provided. Must be a valid YouTube video URL.');
        }
        
        this.playQueue.push(item);
        console.log(`Added item to queue for channel ${this.channel.id}: ${item.userInputUrl}`);
        
        if(playlist) {
            this.playlistItems.push(playlist);
            console.log(`Added playlist to queue for channel ${this.channel.id}: ${playlist.title}`);
        }
        
        await this.checkAndUpdatePlayerState();
    }
    
    /**
     * Checks the current state of the audio player and updates it if necessary
     */
    private async checkAndUpdatePlayerState(): Promise<void> {
        this.clearUnusedPlaylistItems();

        if( this.audioPlayerStatus === AudioPlayerStatus.Playing || this.audioPlayerStatus === AudioPlayerStatus.Paused) {
            return;
        }

        if (this.playQueue.length === 0) {
            console.log(`No items in queue for channel ${this.channel.id}.`);
            return;
        }
        
        if(this.connection.state.status !== "ready") {
            console.error(`Voice connection is not ready for channel ${this.channel.id}. Cannot play audio.`);
            return;
        }
        
        if (this.audioPlayerStatus === AudioPlayerStatus.Idle) {
            console.log(`Audio player is idle for channel ${this.channel.id}. Attempting to play next item.`);

            // Next queued item
            const nextItem = this.playQueue.shift();
            if (nextItem) {
                console.log(`Playing next item from queue for channel ${this.channel.id}: ${nextItem.userInputUrl}`);
                this.currentItem = nextItem;
                if(!nextItem.isOutputUrlSet){
                    console.log(`Setting output stream URL for item in channel ${this.channel.id}: ${nextItem.userInputUrl}`);
                    await nextItem.setOutputStreamUrl();
                }
                await this.playAudio(nextItem);
                
                if(this.playQueue.length > 0) {
                    this.playQueue[0].setOutputStreamUrl();
                }
            } else {
                console.log(`No next item to play for channel ${this.channel.id}.`);
            }
        }
    }
    
    /**
     * Clears unused playlist items that are not part of the current play queue
     */
    private async clearUnusedPlaylistItems() {
        const playlistCount = this.playlistItems.length;
        const usedPlaylistItemIds = new Set(this.playQueue.map(item => item.playlistId));
        this.playlistItems = this.playlistItems.filter(item => usedPlaylistItemIds.has(item.playlistId));
        if(this.playlistItems.length < playlistCount) {
            console.log(`Cleared ${playlistCount - this.playlistItems.length} unused playlist items for channel ${this.channel.id}.`);
        }
    }
    
    /**
     * Handles audio player status changes and manages timeouts accordingly
     */
    private handleStatusChange(status: AudioPlayerStatus): void {
        switch (status) {
            case AudioPlayerStatus.Idle:
                if (this.playQueue.length === 0) {
                    this.setInactivityTimeout(TimeoutType.IDLE);
                } else {
                    this.clearInactivityTimeout();
                }
                break;
                
            case AudioPlayerStatus.Paused:
                this.setInactivityTimeout(TimeoutType.PAUSE);
                break;
                
            case AudioPlayerStatus.Playing:
                this.clearInactivityTimeout();
                break;
                
            default:
                // For other statuses (Buffering, AutoPaused), clear timeout to be safe
                this.clearInactivityTimeout();
                break;
        }
    }
    
    /**
     * Plays the audio for the provided item
     * @throws Error if the audio player is not initialized or if the output stream URL is not set
     * @param item The audio item to play
     */
    public async playAudio(item: QueuedAudioItem): Promise<void> {
        if (!this.player) {
            console.error('Audio player is not initialized.');
            throw new Error('Audio player is not initialized. Cannot play audio.');
        }
        
        if (!item.outputStreamUrl) {
            console.error('Output stream URL is not set for the item. Cannot play audio.');
            throw new Error('Output stream URL is not set for the item. Cannot play audio.');
        }
        
        if( this.audioPlayerStatus === AudioPlayerStatus.Playing || this.audioPlayerStatus === AudioPlayerStatus.Paused) {
            console.log(`Audio player is already playing or paused for channel ${this.channel.id}. Stopping current playback.`);
            this.player.stop();
        }
        
        console.log(`Playing audio for item in channel ${this.channel.id}: ${item.userInputUrl}`);
        
        const resource = await this.createAudioStream(item.outputStreamUrl);
        this.player.play(resource);

        let itemDetails = `"${item.title}" - ${item.displayDuration} - <${item.userInputUrl}>`;
        if(this.currentItem && this.isCurrentItemPlaylist) {
            const playlistItem = this.currentPlaylistItem;
            const playlistDetails = `Playlist "${playlistItem?.title}" - ${playlistItem?.itemCount} Items - `
                + `Total Duration: ${QueuedAudioItem.formatDuration(playlistItem?.duration || 0)}`;
            this.messageOutCallback?.(`▶️ Now Playing ${playlistDetails}\n[#${this.currentItem.playlistIndex} of ${playlistItem?.itemCount}]: ${this.currentItem.title}`);
        } else {
            this.messageOutCallback?.(`▶️ Now playing: ${itemDetails}`)
        }
    }

    /**
     * Stops audio playback
     */
    public async stop(): Promise<void> {
        if (!this.player) {
            console.error('Audio player is not initialized.');
            throw new Error('Audio player is not initialized. Cannot stop audio.');
        }
        
        if (this.audioPlayerStatus === AudioPlayerStatus.Idle) {
            console.log(`Audio player is already idle for channel ${this.channel.id}. Nothing to stop.`);
            this.messageOutCallback?.(`❗ Audio player is not currently playing.`);
            return;
        }

        console.log(`Stopping audio playback for channel ${this.channel.id}.`);
        this.playQueue = [];
        this.currentItem = null;
        this.player.stop();
        this.messageOutCallback?.(`⏹️ Stopped audio playback and cleared play queue.`);
    }
    
    /**
     * Skips the current audio playback and plays the next item in the queue
     */
    public async skip(skipItemList: boolean = false): Promise<void> {
        if (!this.player) {
            console.error('Audio player is not initialized.');
            return;
        }

        if (this.playQueue.length === 0) {
            console.log(`No items to skip in queue for channel ${this.channel.id}.`);
            this.messageOutCallback?.(`❗ No items to skip in the queue.`);
            return;
        }

        console.log(`Skipping current audio ${skipItemList ? 'playlist' : 'track'} for channel ${this.channel.id}.`);
        if (skipItemList) {
            const playlistId = this.currentItem?.playlistId || '';
            if(playlistId === '') {
                console.log(`Current item is not part of a playlist. Skipping single track instead.`);
                this.player.stop();
                return;
            }
            let skipItemCount = 0;
            for(let i=0; i<this.playQueue.length; i++) {
                const item = this.playQueue[i];
                if(item.playlistId !== playlistId) {
                    skipItemCount = i;
                    break;
                }
            }
            if(skipItemCount > 0)
            {
                this.playQueue.splice(0, skipItemCount);
            }
        }
        this.player.stop();
    }
    
    /**
     * Pauses the current audio playback 
     * @throws Error if the audio player is not initialized
     */
    public async pause(): Promise<void> {
        if (!this.player) {
            console.error('Audio player is not initialized.');
            throw new Error('Audio player is not initialized. Cannot pause audio.');
        }
        
        if (this.audioPlayerStatus !== AudioPlayerStatus.Playing) {
            console.log(`Audio player is not currently playing for channel ${this.channel.id}. Cannot pause.`);
            this.messageOutCallback?.(`❗ Audio player is not currently playing.`);
            return;
        }
        
        console.log(`Pausing audio playback for channel ${this.channel.id}.`);
        this.player.pause();
        this.messageOutCallback?.(`⏸️ Paused audio playback .`);
    }
    
    /**
     * Resumes the current audio playback
     * @throws Error if the audio player is not initialized
     */
    public async resume(): Promise<void> {
        if (!this.player) {
            console.error('Audio player is not initialized.');
            throw new Error('Audio player is not initialized. Cannot resume audio.');
        }
        
        if (this.audioPlayerStatus !== AudioPlayerStatus.Paused) {
            console.log(`Audio player is not currently paused for channel ${this.channel.id}. Cannot resume.`);
            this.messageOutCallback?.(`❗ Audio player is not currently paused.`);
            return;
        }
        
        console.log(`Resuming audio playback for channel ${this.channel.id}.`);
        this.player.unpause();
        this.messageOutCallback?.(`▶️ Resumed audio playback.`);
    }
    
    public getQueue(): QueuedAudioItem[] {
        return this.playQueue;
    }

    public getPlaylistItem(queuedItem: QueuedAudioItem): PlaylistItem | null {
        if (!queuedItem || !queuedItem.playlistId) return null;
        return this.playlistItems.find(item => item.playlistId === queuedItem.playlistId) || null;
    }

    /**
     * Cleanup method to clear timeouts and resources
     */
    public destroy(): void {
        console.log(`Destroying audio player for channel ${this.channel.id}`);
        this.clearInactivityTimeout();
        
        if (this.player && (this.audioPlayerStatus === AudioPlayerStatus.Playing || this.audioPlayerStatus === AudioPlayerStatus.Paused)) {
            this.player.stop();
        }

        if (this.connection) {
            if (this.connection.state.status !== "disconnected" && this.connection.state.status !== "destroyed") {
                this.connection.disconnect();
                if (this.voiceConnectionStatus !== "destroyed") {
                    this.connection.destroy();
                } 
            }
        }
        
        this.playQueue = [];
    }

    /**
     * Creates an audio stream from the provided URL
     * @param url The URL to create an audio stream from
     * @throws Error if the URL is invalid or if FFmpeg fails to start
     * @description Creates an audio stream from the provided URL using FFmpeg
     * @returns {Promise<AudioResource>} The audio resource created from the stream
     */
    public async createAudioStream(url: string): Promise<AudioResource> {
        console.log(`Creating audio stream from URL: ${url}`);
        const ffmpegArgs = [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', url,
            '-analyzeduration', '0',
            '-loglevel', 'error',
            '-c:a', 'libopus',
            '-f', 'ogg',
            '-filter:a', 'loudnorm',
            'pipe:1',
        ];
        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, capture stdout and stderr
        });
        
        console.log('FFmpeg process started for audio stream.');
        console.log(`FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
        
        // Capture stderr for debugging
        let stderrData = '';
        ffmpeg.stderr.on('data', (data: Buffer) => {
            stderrData += data.toString();
        });
        
        const audioResource = createAudioResource(ffmpeg.stdout, {
            inputType: StreamType.OggOpus,
            metadata: {
                title: 'Audio Stream',
                url,
            },
        });
        
        ffmpeg.on('error', (error: any) => {
            console.error('FFmpeg error:', error);
        });

        ffmpeg.on('close', (code: number) => {
            if (code !== 0) {
                console.error(`FFmpeg process exited with code ${code}`);
                if (stderrData) {
                    console.error('FFmpeg stderr:', stderrData);
                }
            } else {
                console.log('FFmpeg process completed successfully');
            }
        });
        
        console.log('Audio resource created from FFmpeg output.');
        return audioResource;
    }
}