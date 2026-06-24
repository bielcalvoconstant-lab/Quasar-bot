require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Inicialização do cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();

// Conectando ao Banco de Dados MongoDB de forma segura
mongoose.connect(process.env.MONGO_URI, {
  bufferCommands: false,
})
.then(() => console.log('[BANCO DE DADOS] Conectado ao MongoDB.'))
.catch(err => console.error('[BANCO DE DADOS] Erro de conexão:', err));

// Carregando comandos modularizados
const commandFolders = fs.readdirSync(path.join(__dirname, 'commands'));
for (const folder of commandFolders) {
  const commandFiles = fs.readdirSync(path.join(__dirname, 'commands', folder)).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(`./commands/${folder}/${file}`);
    client.commands.set(command.data.name, command);
  }
}

// Carregando manipuladores de eventos
const eventFiles = fs.readdirSync(path.join(__dirname, 'events')).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(`./events/${file}`);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

// Inicializando o servidor web administrativo
const { startDashboard } = require('./dashboard/server.js');
startDashboard(client);

// Autenticando o Bot no Discord
client.login(process.env.DISCORD_TOKEN).catch(console.error);

// Tratamento global de erros para estabilidade da aplicação
process.on('unhandledRejection', error => {
  console.error('[ERRO NÃO TRATADO]', error);
});
