import { AudioPlayer, AudioResource, createAudioResource, StreamType } from "@discordjs/voice";
import { Client, Interaction, VoiceBasedChannel, ApplicationCommandOptionType} from "discord.js";
const { spawn, execSync } = require('child_process');

const {
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    AudioPlayerStatus,
} = require('@discordjs/voice');


async function playAudio(channel: VoiceBasedChannel, audioResource: AudioResource): Promise<AudioPlayer> {
    console.log(`Playing audio in channel: ${channel.name}`);
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    console.log(`Joined voice channel: ${channel.name}`);

    connection.on('error', (error: any) => {
        console.error('Connection error:', error);
    });

    connection.on('stateChange', (oldState: any, newState: any) => {
        console.log(`Connection state changed from ${oldState.status} to ${newState.status}`);
        if (newState.status === 'disconnected') {
            console.log(`Disconnected from voice channel: ${channel.name}`);
        }
    });

    console.log(`Creating audio player for channel: ${channel.name}`);
    const player = createAudioPlayer({
        behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause,
        },
    });

    // Add more detailed player event logging
    player.on('stateChange', (oldState: any, newState: any) => {
        console.log(`Audio player state changed from ${oldState.status} to ${newState.status}`);
    });

    player.on('error', (error: any) => {
        console.error('Audio player error:', error);
    });

    console.log(`Subscribing player to connection for channel: ${channel.name}`);
    connection.subscribe(player);
    
    player.play(audioResource);
    
    return player;
}

async function fetchAudioStreamUrl(url: string): Promise<string> {
    if (!url.startsWith('http')) {
        console.error('Invalid URL provided. Must start with http or https.');
        throw new Error('Invalid URL provided. Must start with http or https.');
    }
    
    console.log(`Fetching audio stream URL for: ${url}`);

    try {
        // Use yt-dlp to fetch the audio stream URL
        const command = `yt-dlp -f bestaudio -g "${url}"`;
        console.log(`Running command: ${command}`);
        const output = execSync(command, { timeout: 30000 }).toString().trim();

        if (!output) {
            console.error('Failed to extract audio stream URL.');
            throw new Error('Failed to extract audio stream URL.');
        }

        console.log(`Extracted audio stream URL: ${output}`);
        
        // Check if the extracted URL is valid
        if (!output.startsWith('http')) {
            console.error('Extracted URL is not valid:', output);
            throw new Error('Extracted URL is not a valid HTTP URL');
        }
        
        return output;
    } catch (error) {
        console.error('Error in fetchAudioStreamUrl:', error);
        throw error;
    }
}

async function createAudioStream(url: string): Promise<AudioResource> {
    console.log(`Creating audio stream from URL: ${url}`);
    const ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', url,
        '-analyzeduration', '0',
        '-loglevel', 'error',
        '-c:a', 'copy',
        '-f', 'ogg',
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

async function playAudioWithConnection(connection: any, audioResource: AudioResource): Promise<AudioPlayer> {
    console.log(`Creating audio player for existing connection`);
    const player = createAudioPlayer({
        behaviors: {
            noSubscriber: NoSubscriberBehavior.Play, // Changed from Pause to Play
        },
    });

    // Add detailed player event logging
    player.on('stateChange', (oldState: any, newState: any) => {
        console.log(`Audio player state changed from ${oldState.status} to ${newState.status}`);
        if (newState.status === 'idle' && oldState.status !== 'idle') {
            console.log('Playback finished or stopped');
        }
    });

    player.on('error', (error: any) => {
        console.error('Audio player error:', error);
    });

    console.log(`Subscribing player to existing connection`);
    const subscription = connection.subscribe(player);
    
    if (!subscription) {
        throw new Error('Failed to subscribe player to connection');
    }
    
    // Wait a bit longer to ensure everything is properly connected
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Starting audio playback...');
    player.play(audioResource);
    
    return player;
}

module.exports = {
    commands: {
        play: {
            description: "Play audio in a voice channel",
            options: [
                {
                    name: "url",
                    type: ApplicationCommandOptionType.String,
                    description: "The URL of the audio to play",
                    required: true,
                },
            ],
            execute: async (client: Client, interaction: Interaction) => {
                // Only proceed if interaction is a ChatInputCommandInteraction
                if (!interaction.isCommand() || !interaction.isChatInputCommand()) {
                    console.error('Interaction is not a command or not a ChatInputCommandInteraction.');
                    return;
                }
                console.log(`Received command: ${interaction.commandName}`);
                const member = interaction.member;
                // Ensure member is a GuildMember (not APIInteractionGuildMember)
                if (!member || !('voice' in member)) {
                    console.error('Member is not a GuildMember or does not have voice properties.');
                    await interaction.reply("You need to be in a voice channel to play audio!");
                    return;
                }
                const channel = (member as any).voice.channel;
                if (!channel) {
                    console.error('Member is not in a voice channel.');
                    await interaction.reply("You need to be in a voice channel to play audio!");
                    return;
                }

                console.log(`User ${interaction.user.tag} is in voice channel: ${channel.name}`);
                console.log(`Channel ID: ${channel.id}, Guild ID: ${channel.guild.id}`);
                const url = interaction.options.getString('url', true);
                
                // Reply immediately to avoid timeout
                await interaction.reply(`🎵 Processing audio from: ${url}`);
                
                try {
                    const streamUrl = await fetchAudioStreamUrl(url);
                    
                    // First establish voice connection
                    const connection = joinVoiceChannel({
                        channelId: channel.id,
                        guildId: channel.guild.id,
                        adapterCreator: channel.guild.voiceAdapterCreator,
                    });

                    console.log(`Joined voice channel: ${channel.name}`);

                    // Add connection event listeners
                    connection.on('error', (error: any) => {
                        console.error('Connection error:', error);
                    });

                    connection.on('stateChange', (oldState: any, newState: any) => {
                        console.log(`Connection state changed from ${oldState.status} to ${newState.status}`);
                    });

                    // Wait for connection to be ready
                    console.log('Waiting for voice connection to be ready...');
                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Voice connection timeout'));
                        }, 15000); // 15 second timeout

                        const checkReady = () => {
                            if (connection.state.status === 'ready') {
                                clearTimeout(timeout);
                                console.log('Voice connection is ready!');
                                resolve();
                            } else {
                                setTimeout(checkReady, 100);
                            }
                        };
                        checkReady();
                    });

                    // Now create the audio stream with stable connection
                    const audioResource = await createAudioStream(streamUrl);
                    const player = await playAudioWithConnection(connection, audioResource);
                    console.log(`Audio is now playing in channel: ${channel.name}`);
                    
                    // Update the original response
                    await interaction.editReply(`▶️ Now playing audio from: ${url}`);
                    
                    player.on(AudioPlayerStatus.Idle, () => {
                        console.log(`Audio playback finished in channel: ${channel.name}`);
                        interaction.followUp("⏹️ Playback finished.");
                    });
                    
                    player.on('error', (error: any) => {
                        console.error('Audio player error:', error);
                        interaction.followUp("❌ An error occurred while playing audio.");
                    });
                } catch (error) {
                    console.error('Error processing audio:', error);
                    await interaction.editReply(`❌ Failed to process audio from: ${url}`);
                }
            },
        },
    },
}