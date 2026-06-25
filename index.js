// index.js
require('dotenv').config();

// CONFIGURAÇÃO AUTOMÁTICA DO CAMINHO DO FFMPEG ESTÁTICO
try {
  const ffmpeg = require('ffmpeg-static');
  process.env.FFMPEG_PATH = ffmpeg; // Informa dinamicamente ao Discord e ao prism-media onde o FFmpeg está
  console.log('[SISTEMA] FFmpeg estático localizado e configurado com sucesso no ambiente.');
} catch (err) {
  console.warn('[AVISO] Não foi possível carregar o ffmpeg-static de forma automática:', err.message);
}

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { startDashboard } = require('./dashboard/server');

// Inicialização do Client do Discord com as intenções de música e moderação
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Coleção para armazenar os comandos slash
client.commands = new Collection();

// ==========================================
// 📥 CARREGAMENTO ROBUSTO DE COMANDOS SLASH
// ==========================================
const commandFolders = fs.readdirSync(path.join(__dirname, 'commands'));
for (const folder of commandFolders) {
  const folderPath = path.join(__dirname, 'commands', folder);
  const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    const filePath = path.join(folderPath, file);
    try {
      const command = require(filePath);
      
      // Validação de segurança recomendada pela documentação oficial do Discord.js v14
      if (command && 'data' in command && 'execute' in command && command.data && command.data.name) {
        client.commands.set(command.data.name, command);
      } else {
        console.warn(`[AVISO COMANDO] O arquivo "${file}" em "commands/${folder}" está sem a propriedade obrigatória "data" ou "execute". Ignorando...`);
      }
    } catch (err) {
      console.error(`[ERRO CARREGAMENTO] Falha ao carregar o comando ${file} em ${folder}:`, err.message);
    }
  }
}

// ==========================================
// 📥 CARREGAMENTO DE EVENTOS
// ==========================================
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  try {
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
  } catch (err) {
    console.error(`[ERRO EVENTO] Falha ao carregar o evento ${file}:`, err.message);
  }
}

// ==========================================
// 🗃️ CONEXÃO MONGODBAtlas & INICIALIZAÇÃO
// ==========================================
mongoose.set('bufferCommands', false); // Desativa o buffer para evitar travamentos silenciosos de conexão lenta

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[BANCO DE DADOS] Conectado ao MongoDB com sucesso.');
    
    // Inicia o painel Express passando o cliente do bot do Discord
    startDashboard(client);

    // Conecta o bot do Discord
    client.login(process.env.DISCORD_TOKEN);
  })
  .catch((err) => {
    console.error('[ERRO BANCO DE DADOS] Falha crítica de conexão ao MongoDB:', err.message);
    process.exit(1);
  });
