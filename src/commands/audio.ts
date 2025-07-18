import { AudioPlayer, AudioResource, createAudioResource, StreamType, VoiceConnection } from "@discordjs/voice";
import { Client, Interaction, VoiceBasedChannel, ApplicationCommandOptionType, TextBasedChannel, TextChannel, time, Guild, Channel} from "discord.js";
import { ChannelAudioPlayer } from "../audio/channel-audio-player";
import { QueuedAudioItem } from "../audio/queued-audio-item";
const { spawn, execSync } = require('child_process');
const {
    joinVoiceChannel,
    AudioPlayerStatus,
} = require('@discordjs/voice');

class GuildAudioCommandHandler {
    public channelAudioPlayer: ChannelAudioPlayer | null = null;

    constructor(
        public guildId: string,
        public client: Client,
        public lastTextChannel: TextBasedChannel,
        public voiceChannel: VoiceBasedChannel,
        public connection: VoiceConnection,
        public closeConnectionCallback: (source: ChannelAudioPlayer | null) => void,
        queuedAudioItem: QueuedAudioItem
    ) {
        try {
            this.channelAudioPlayer = new ChannelAudioPlayer(
                this.guildId,
                this.connection,
                this.voiceChannel,
                this.closeConnectionCallback,
                this.messageOut
            );
        }
        catch (error) {
            console.error('Error creating ChannelAudioPlayer:', error);
            this.channelAudioPlayer = null;
        }
    }
    
    async messageOut(message: string): Promise<void> {
        const channelOut = this.lastTextChannel;
        if (channelOut && channelOut.isTextBased() && channelOut instanceof TextChannel) {
            await channelOut.send(message);
        } else {
            console.error('Last text channel is not valid or not a text channel.');
        }
    }
    
    async destroy(): Promise<void> {
        if (this.channelAudioPlayer) {
            this.channelAudioPlayer.destroy();
            this.channelAudioPlayer = null;
        }
    }
}

interface ValidatedInteractionData {
    textChannel: TextBasedChannel;
    voiceChannel: VoiceBasedChannel;
    member: any;
    interaction: any; // ChatInputCommandInteraction
}

const GuildAudioCommandHandlers: Map<string, GuildAudioCommandHandler> = new Map();

async function validateAndExtractInteractionData(interaction: Interaction): Promise<ValidatedInteractionData> {
    // Only proceed if interaction is a ChatInputCommandInteraction
    if (!interaction.isCommand() || !interaction.isChatInputCommand()) {
        console.error('Interaction is not a command or not a ChatInputCommandInteraction.');
        throw new Error('Invalid interaction type');
    }
    
    console.log(`Received command: ${interaction.commandName}`);
    const member = interaction.member;
    
    // Ensure member is a GuildMember (not APIInteractionGuildMember)
    if (!member || !('voice' in member)) {
        console.error('Member is not a GuildMember or does not have voice properties.');
        await interaction.reply("You need to be in a voice channel to play audio!");
        throw new Error('Invalid member');
    }
    
    const textChannel = interaction.channel;
    if (!textChannel) {
        console.error('Interaction channel is not a text channel.');
        await interaction.reply("This command can only be used in a text channel!");
        throw new Error('Invalid text channel');
    }

    const voiceChannel = (member as any).voice.channel;
    if (!voiceChannel) {
        console.error('Member is not in a voice channel.');
        await interaction.reply("You need to be in a voice channel to play audio!");
        throw new Error('Member not in voice channel');
    }

    console.log(`User ${interaction.user.tag} is in voice channel: ${voiceChannel.name}`);
    console.log(`Channel ID: ${voiceChannel.id}, Guild ID: ${voiceChannel.guild.id}`);
    
    return {
        textChannel,
        voiceChannel,
        member,
        interaction
    };
}

async function getGuildAudioCommandHandler(
    client: Client,
    interaction: Interaction,
    textChannel: TextBasedChannel,
    voiceChannel: VoiceBasedChannel,
    queuedAudioItem: QueuedAudioItem | null = null
): Promise<GuildAudioCommandHandler | null> {
    const guildId = interaction.guildId;
    if (!guildId) {
        console.error('Guild ID is not available in the interaction.');
        return null;
    }
    
    // Check if we already have a handler for this guild
    let handler = GuildAudioCommandHandlers.get(guildId);
    if (handler) {
        console.log(`Found existing handler for guild ${guildId}`);
        return handler;
    }

    const connection = await joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    console.log(`Joined voice channel: ${voiceChannel.name}`);

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

    if (queuedAudioItem) {
        const newHandler = new GuildAudioCommandHandler(guildId, client, textChannel, voiceChannel, connection, onCloseConnection, queuedAudioItem);
        if(newHandler.channelAudioPlayer) {
            return newHandler;
        }
    }
    return null;
}

function onCloseConnection(source: ChannelAudioPlayer | null): void {
    if (source) {
        console.log('Voice connection closed.');
        source.destroy();
        GuildAudioCommandHandlers.delete(source.guildId);
    }
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
                try {
                    const { textChannel, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    const url = validatedInteraction.options.getString('url', true);
                
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Requesting audio from: ${url}`);
                
                    let queuedAudioItem = await QueuedAudioItem.createFromUrl(url, Date.now());
                    
                    if(!queuedAudioItem.isValidUrl) {
                        console.error('Invalid URL provided. Must be a valid YouTube video URL.');
                        await validatedInteraction.editReply("❌ Invalid URL provided. Must be a valid YouTube video URL.");
                        return;
                    }
                    else if(!queuedAudioItem.isYoutubeUrl) {
                        console.error('Invalid YouTube URL provided.');
                        await validatedInteraction.editReply("❌ Invalid YouTube URL provided.");
                        return;
                    }
                    else if(queuedAudioItem.isYoutubePlaylist) {
                        console.error('YouTube playlists are not supported.');
                        await validatedInteraction.editReply("❌ YouTube playlists are not supported.");
                        return;
                    }
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, interaction, textChannel, voiceChannel, queuedAudioItem)
                    await commandHandler?.channelAudioPlayer?.addToQueue(queuedAudioItem);
                    
                } catch (error) {
                    console.error('Error processing audio play command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to process audio`);
                        } else {
                            await interaction.reply(`❌ Failed to process audio`);
                        }
                    }
                }
            },
        },
        stop: {
            description: "Stop audio in a voice channel",
            options: [ ],
            execute: async (client: Client, interaction: Interaction) => {
                try {
                    const { textChannel, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User stopping currently playing audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, interaction, textChannel, voiceChannel)
                    await commandHandler?.channelAudioPlayer?.stop()
                    
                } catch (error) {
                    console.error('Error processing audio stop command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to stop Audio`);
                        } else {
                            await interaction.reply(`❌ Failed to stop Audio`);
                        }
                    }
                }
            },
        },
        skip: {
            description: "Skip audio in a voice channel",
            options: [ ],
            execute: async (client: Client, interaction: Interaction) => {
                try {
                    const { textChannel, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Skipping Currently Playing Audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, interaction, textChannel, voiceChannel);
                    await commandHandler?.channelAudioPlayer?.skip();
                    
                } catch (error) {
                    console.error('Error processing audio skip command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to skip audio`);
                        } else {
                            await interaction.reply(`❌ Failed to skip audio`);
                        }
                    }
                }
            },
        },
        pause: {
            description: "Pause audio in a voice channel",
            options: [ ],
            execute: async (client: Client, interaction: Interaction) => {
                try {
                    const { textChannel, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Pausing Currently Playing Audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, interaction, textChannel, voiceChannel);
                    await commandHandler?.channelAudioPlayer?.pause();

                } catch (error) {
                    console.error('Error processing audio pause command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to pause audio`);
                        } else {
                            await interaction.reply(`❌ Failed to pause audio`);
                        }
                    }
                }
            },
        },
        resume: {
            description: "Resume audio in a voice channel",
            options: [ ],
            execute: async (client: Client, interaction: Interaction) => {
                try {
                    const { textChannel, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Resuming Currently Paused Audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, interaction, textChannel, voiceChannel);
                    await commandHandler?.channelAudioPlayer?.resume();

                } catch (error) {
                    console.error('Error processing audio resume command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to resume audio`);
                        } else {
                            await interaction.reply(`❌ Failed to resume audio`);
                        }
                    }
                }
            },
        },
    },
}