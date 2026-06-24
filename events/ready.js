const { Events, ActivityType } = require('discord.js');
const BotSettings = require('../models/BotSettings');
const fs = require('fs');
const path = require('path');
const play = require('play-dl'); // Importa o play-dl para aplicar os cookies de bypass

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[QUASAR BOT] Logado com sucesso como ${client.user.tag}`);

    // ==========================================
    // 🛡️ CONFIGURAÇÃO DE BYPASS ANTI-BOT DO YOUTUBE
    // ==========================================
    if (process.env.YOUTUBE_COOKIE) {
      try {
        // Envia os cookies configurados no Railway para o play-dl autenticar as requisições
        await play.setToken({
          youtube: {
            cookie: process.env.YOUTUBE_COOKIE
          }
        });
        console.log('[PLAY-DL] Cookies do YouTube injetados com sucesso. Proteção anti-bot ativa.');
      } catch (cookieErr) {
        console.error('[PLAY-DL ERRO] Falha ao injetar os cookies do YouTube no reprodutor:', cookieErr.message);
      }
    } else {
      console.warn('[PLAY-DL AVISO] Nenhuma variável YOUTUBE_COOKIE foi configurada no Railway. Transmissões do YouTube podem falhar por bloqueio de robô.');
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
