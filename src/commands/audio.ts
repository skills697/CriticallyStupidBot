import { AudioPlayer, AudioResource, createAudioResource, StreamType, VoiceConnection } from "@discordjs/voice";
import { Client, Interaction, VoiceBasedChannel, ApplicationCommandOptionType, TextBasedChannel, TextChannel, time, Guild, Channel, ChannelType, WebhookClient} from "discord.js";
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
        public voiceChannel: VoiceBasedChannel,
        public connection: VoiceConnection,
        public closeConnectionCallback: (source: ChannelAudioPlayer | null) => void,
        queuedAudioItem: QueuedAudioItem,
        public channelId: string, 
    ) {
        try {
            this.channelAudioPlayer = new ChannelAudioPlayer(
                this.guildId,
                this.connection,
                this.voiceChannel,
                this.closeConnectionCallback,
                this.messageOut,
            );
        }
        catch (error) {
            console.error('Error creating ChannelAudioPlayer:', error);
            this.channelAudioPlayer = null;
        }
    };

    /**
     * Sends a message to the text channel associated with the guild.
     * @param message The message to send.
     * @returns A promise that resolves when the message is sent.
     */
    messageOut = async (message: string): Promise<void> => {
        if( !this.channelId || !this.client || !this.client.isReady() ) {
            console.error('Cannot send message: Invalid channelId or client not ready.');
            return;
        }

        const channel = this.client.channels.cache.get(this.channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            console.error('Invalid channel or channel is not a text channel.');
            return;
        }

        try {
            channel.send(message);
        } catch (error) {
            console.error('Error sending channel message:', error);
        }
    };
    
    async destroy(): Promise<void> {
        if (this.channelAudioPlayer) {
            this.channelAudioPlayer.destroy();
            this.channelAudioPlayer = null;
        }
    };
};

interface ValidatedInteractionData {
    channelId: string;
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
    
    const channelId = interaction.channelId || (interaction.channel as TextBasedChannel)?.id || (interaction.channel as TextChannel)?.id;
    if (!interaction.channel || !interaction.isChatInputCommand()) {
        console.error('Interaction is not a text command.');
        await interaction.reply("This command can only be used in a text channel!");
        throw new Error('Invalid text command interaction');
    }
    
    if(!channelId) {
        console.error('Channel ID is not available in the interaction.');
        await interaction.reply("Channel ID is not available in the interaction.");
        throw new Error('Channel ID not found');
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
        channelId,
        voiceChannel,
        member,
        interaction
    };
}

async function getGuildAudioCommandHandler(
    client: Client,
    interaction: Interaction,
    channelId: string,
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
        console.log(`assigning channelId: ${channelId} to existing handler`);
        handler.channelId = channelId;
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
        const newHandler = new GuildAudioCommandHandler(
            guildId,
            client,
            voiceChannel,
            connection,
            onCloseConnection,
            queuedAudioItem,
            channelId);
        if(newHandler.channelAudioPlayer) {
            GuildAudioCommandHandlers.set(guildId, newHandler);
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
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
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
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel, queuedAudioItem)
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
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User stopping currently playing audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel)
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
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Skipping Currently Playing Audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel);
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
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Pausing Currently Playing Audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel);
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
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User Resuming Currently Paused Audio`);

                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel);
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
        playing: {
            description: "Get currently playing audio in a voice channel, and any queued audio",
            options: [ ],
            execute: async (client: Client, interaction: Interaction) => {
                try {
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);
                    
                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User requesting currently playing audio`);
                    
                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel);
                    if(commandHandler?.channelAudioPlayer) {
                        const currentAudio = commandHandler.channelAudioPlayer.getCurrentAudio();
                        const queue = commandHandler.channelAudioPlayer.getQueue();
                        let responseMessage = `Currently playing audio:\n`;
                        if(currentAudio) {
                            responseMessage += `- ${currentAudio.UserInputUrl}\n`;
                        } else {
                            responseMessage += `- No audio is currently playing.\n`;
                        }
                        if(queue.length > 0) {
                            responseMessage += `\nQueued audio:\n`;
                            queue.forEach((item, index) => {
                                if(index <= 5) {
                                    responseMessage += `  ${index + 1}. <` + item.UserInputUrl + `>\n`;
                                }
                            });
                        } else {
                            responseMessage += `- No audio is queued.\n`;
                        }
                        if(queue.length > 5) {
                            responseMessage += `\n...and ${queue.length - 5} more items in the queue.`;
                        }
                        await validatedInteraction.editReply(responseMessage);
                    } else {
                        await validatedInteraction.editReply("❌ No audio player found for this guild.");
                    }
                } catch (error) {
                    console.error('Error processing audio playing command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to get currently playing audio`);
                        } else {
                            await interaction.reply(`❌ Failed to get currently playing audio`);
                        }
                    }
                }
            },
        },
        leave: {
            description: "Leave the voice channel",
            options: [ ],
            execute: async (client: Client, interaction: Interaction) => {
                try {
                    const { channelId, voiceChannel, interaction: validatedInteraction } = await validateAndExtractInteractionData(interaction);

                    // Reply immediately to avoid timeout
                    await validatedInteraction.reply(`User requesting to leave voice channel`);

                    const commandHandler = await getGuildAudioCommandHandler(client, validatedInteraction, channelId, voiceChannel);
                    const player = commandHandler?.channelAudioPlayer;
                    if(player) {
                        await player.stop();
                        onCloseConnection(player);
                    }

                } catch (error) {
                    console.error('Error processing audio leave command:', error);
                    if (interaction.isChatInputCommand()) {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.editReply(`❌ Failed to leave voice channel`);
                        } else {
                            await interaction.reply(`❌ Failed to leave voice channel`);
                        }
                    }
                }
            }
        },
    },
};