const { Events, ActivityType } = require('discord.js');
const BotSettings = require('../models/BotSettings');
const fs = require('fs');
const path = require('path');
const play = require('play-dl');

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
        const cleanedCookie = process.env.YOUTUBE_COOKIE.replace(/^[\\"\s]+|[\\"\s]+$/g, '').trim();
        
        const truncatedCheck = cleanedCookie.substring(0, 60);
        console.log(`[PLAY-DL DEBUG] Cookie limpo carregado no terminal: "${truncatedCheck}..."`);

        await play.setToken({
          youtube: {
            cookie: cleanedCookie
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
    // 🎫 CONFIGURAÇÃO DE TOKEN ESTÁVEL DO SOUNDCLOUD (FALLBACK)
    // ==========================================
    try {
      // CORREÇÃO: Utiliza a chave pública ativa 'qMNlQ19f7XBPO8xzq12CnSEiq2zGWrlJ' para evitar o erro 401
      await play.setToken({
        soundcloud: {
          client_id: process.env.SOUNDCLOUD_CLIENT_ID || 'qMNlQ19f7XBPO8xzq12CnSEiq2zGWrlJ'
        }
      });
      console.log('[PLAY-DL] Token do SoundCloud configurado com sucesso para fallback.');
    } catch (scErr) {
      console.error('[PLAY-DL ERRO] Falha ao injetar token do SoundCloud:', scErr.message);
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
