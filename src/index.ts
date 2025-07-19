require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {Client, IntentsBitField} = require('discord.js');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildVoiceStates,
    ]
});

const IsTestServer = false; // Set to true if you want to use the test server

async function setGuildCommands(client: any, guildId: string | undefined) {
    // compare commands with the existing ones for this guild
    const guild = guildId ? await client.guilds.cache.get(guildId) : null;
    const applicationCommands = (guildId)
        ? await guild.commands
        : await client.application?.commands
        
    if (applicationCommands) {
        applicationCommands.fetch();
    }

    console.log('Loaded commands:', Array.from(client.commands.keys()));
    console.log('Existing commands:', applicationCommands);

    const commandsToRegister: any[] = [];
    const commandsToEdit: any[] = [];
    const commandsToDelete: any[] = [];
    if (applicationCommands) {
        for(const [name, command] of client.commands) {
            const existingCommand = await applicationCommands.cache.find(
                (cmd:any) => cmd.name === name
            );
            if (existingCommand) {
                console.log(`Command ${name} already exists.`);
                commandsToEdit.push({
                    id: existingCommand.id,
                    description: existingCommand.description,
                    options: existingCommand.options || [],
                });
            } else {
                console.log(`Command ${name} does not exist, will be registered.`);
                commandsToRegister.push({
                    name,
                    description: command.description,
                    options: command.options || [],
                });
            }
        }
        for(const existingCommand of applicationCommands.cache) {
            if (!client.commands.has(existingCommand.name)) {
                console.log(`Command ${existingCommand.name} exists but is not in the current commands, will be deleted.`);
                commandsToDelete.push({
                    id: existingCommand.id,
                    name: existingCommand.name,
                    description: existingCommand.description,
                    options: existingCommand.options || [],
                });
            }
        }
    }
    
    console.log('Commands to register:', commandsToRegister);
    console.log('Commands to edit:', commandsToEdit);
    console.log('Commands to delete:', commandsToDelete); 
    if (applicationCommands) {
        // Delete, register, and edit commands as needed
        for (const command of commandsToDelete) {
            await applicationCommands.delete(command.id).then(() => {
                console.log(`Command ${command.name} deleted successfully.`);
            }).catch(console.error);
        }

        for (const command of commandsToRegister) {
            await applicationCommands.create(command).then(() => {
                console.log(`Command ${command.name} registered successfully.`);
            }).catch(console.error);
        }

        for (const command of commandsToEdit) {
            await applicationCommands.edit(command.id, {
                description: command.description,
                options: command.options || [],
            }).then(() => {
                console.log(`Command ${command.name} edited successfully.`);
            }).catch(console.error);
        }
    } else {
        console.error('Application commands not found.');
    }
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Load commands from the commands directory
    client.commands = new Map();
    const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter((file:any) => file.endsWith('.js'));
    for (const file of commandFiles) {
        const { commands } = require(`./commands/${file}`);
        const commandKeys = Object.keys(commands);
        for (const commandName of commandKeys) {
            const command = commands[commandName];
            client.commands.set(commandName, command);
        }
    }
    
    // Set guild commands
    const guildId = (IsTestServer) ? process.env.TEST_SERVER_ID : process.env.MAIN_SERVER_ID;
    if (guildId) {
        setGuildCommands(client, guildId).then(() => {
            console.log(`Commands set for guild: ${guildId}`);
        }).catch(console.error);
    } else {
        console.error('MAIN_SERVER_ID or TEST_SERVER_ID not set in .env file.');
    }
});

client.on('messageCreate', (message:any) => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

client.login(process.env.DTOKEN).then(() => {
    console.log('Bot is online!');
}).catch(console.error);
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});
process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

// interaction handler
client.on('interactionCreate', async (interaction:any) => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(client, interaction);
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

if (require.main === module) {
    client.login(process.env.DTOKEN).catch(console.error);
}
module.exports = client;
