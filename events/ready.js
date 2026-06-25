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
    // 🎫 CONFIGURAÇÃO DE BYPASS DO SOUNDCLOUD (EXCLUSIVO)
    // ==========================================
    try {
      // CORREÇÃO: Utiliza a chave ativa de 2026 'vjvE4M9RytEg9W09NH1ge2VyrZPUSKo5' como fallback principal
      const scClientId = process.env.SOUNDCLOUD_CLIENT_ID || 'vjvE4M9RytEg9W09NH1ge2VyrZPUSKo5';
      
      await play.setToken({
        soundcloud: {
          client_id: scClientId
        }
      });
      
      console.log(`[PLAY-DL] Token do SoundCloud configurado com sucesso. ID ativo: "${scClientId.substring(0, 8)}..."`);
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
