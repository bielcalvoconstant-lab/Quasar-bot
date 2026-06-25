const { Events, ActivityType } = require('discord.js');
const BotSettings = require('../models/BotSettings');
const fs = require('fs');
const path = require('path');
const play = require('play-dl');
const axios = require('axios'); // Necessário para efetuar a raspagem dinâmica

// ==========================================
// 🔍 CAPTURADOR DINÂMICO DE CHAVES (SOUNDCLOUD)
// ==========================================
async function getDynamicSoundCloudClientId() {
  // Simula um navegador desktop padrão de alta reputação para burlar bloqueios geográficos de IP do CloudFront
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  try {
    // 1. Baixa o HTML da página inicial do SoundCloud
    const response = await axios.get('https://soundcloud.com', {
      headers: { 'User-Agent': userAgent }
    });
    
    const html = response.data;
    
    // 2. Localiza todos os links dos arquivos JS carregados no assets do SoundCloud
    const regexJs = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
    const jsUrls = [];
    let match;
    while ((match = regexJs.exec(html)) !== null) {
      jsUrls.push(match[1]);
    }

    if (jsUrls.length === 0) {
      throw new Error('Nenhum arquivo JS de carregamento localizado.');
    }

    // 3. Vasculha os scripts de trás para frente (geralmente a chave ativa do site está nos últimos arquivos)
    const regexClientId = /client_id\s*:\s*"([a-zA-Z0-9]{32})"/;
    for (let i = jsUrls.length - 1; i >= 0; i--) {
      try {
        const jsResponse = await axios.get(jsUrls[i], {
          headers: { 'User-Agent': userAgent }
        });
        const jsCode = jsResponse.data;
        const idMatch = jsCode.match(regexClientId);
        
        if (idMatch && idMatch[1]) {
          return idMatch[1]; // Retorna a chave de produção ativa extraída em tempo real!
        }
      } catch (scriptErr) {
        // Ignora falhas em scripts individuais e continua tentando os anteriores
      }
    }
    
    throw new Error('Nenhuma chave ativa encontrada nos pacotes JS.');
  } catch (err) {
    console.warn('[SOUNDCLOUD SCRAPER] Não foi possível extrair a chave dinamicamente:', err.message);
    return null;
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[QUASAR BOT] Logado com sucesso como ${client.user.tag}`);

    // ==========================================
    // 🎫 CONFIGURAÇÃO INTELIGENTE DO SOUNDCLOUD
    // ==========================================
    try {
      // 1. Tenta obter uma chave oficial ativa em tempo real diretamente do site do SoundCloud
      let scClientId = await getDynamicSoundCloudClientId();

      if (scClientId) {
        console.log('[PLAY-DL] Chave dinâmica extraída do SoundCloud com sucesso.');
      } else {
        // 2. Se a raspagem falhar por instabilidade, recorre à variável de ambiente ou chave reserva
        scClientId = process.env.SOUNDCLOUD_CLIENT_ID || 'vjvE4M9RytEg9W09NH1ge2VyrZPUSKo5';
        console.log('[PLAY-DL] Recorrendo ao chave reserva de fallback.');
      }
      
      await play.setToken({
        soundcloud: {
          client_id: scClientId
        }
      });
      
      console.log(`[PLAY-DL] SoundCloud autenticado com sucesso. Token Ativo: "${scClientId.substring(0, 8)}..."`);
    } catch (scErr) {
      console.error('[PLAY-DL ERRO] Falha crítica de inicialização do token SoundCloud:', scErr.message);
    }

    // ==========================================
    // 📢 IMPLANTAÇÃO AUTOMÁTICA DE COMANDOS SLASH (/)
    // ==========================================
    try {
      const commands = [];
      const commandFolders = fs.readdirSync(path.join(__dirname, '../commands'));
      for (const folder of commandFolders) {
        const commandFiles = fs.readdirSync(path.join(__dirname, '../commands', folder)).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
          const command = require(`../commands/${folder}/${file}`);
          if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
          }
        }
      }

      await client.application.commands.set(commands);
      console.log(`[REGISTRO] ${commands.length} comandos slash (/) instalados automaticamente de forma global.`);
    } catch (err) {
      console.error('[ERRO REGISTRO COMANDOS]', err);
    }

    // ==========================================
    // 💎 CARREGAMENTO DE PRESENÇA E STATUS DO BANCO
    // ==========================================
    try {
      let settings = await BotSettings.findOne();
      if (!settings) {
        settings = await BotSettings.create({
          status: 'online',
          activityEmoji: '💎',
          activityText: 'Toque músicas de alta definição'
        });
      }

      client.user.setPresence({
        status: settings.status,
        activities: [{
          name: 'custom',
          type: ActivityType.Custom,
          state: `${settings.activityEmoji} ${settings.activityText}`
        }]
      });

      console.log('[PRESENÇA] Status e atividade carregados com sucesso.');
    } catch (error) {
      console.error('[ERRO PRESENÇA]', error);
    }
  },
};
