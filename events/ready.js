const { Events, ActivityType } = require('discord.js');
const BotSettings = require('../models/BotSettings');

module.exports = {
  // Alterado de 'ready' para Events.ClientReady ('clientReady') para eliminar o aviso de depreciação nos logs
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[QUASAR BOT] Logado com sucesso como ${client.user.tag}`);

    try {
      // Busca as configurações globais de presença salvas no banco de dados
      let settings = await BotSettings.findOne();

      // Caso não existam configurações salvas ainda, cria o registro padrão no MongoDB
      if (!settings) {
        settings = await BotSettings.create({
          status: 'online',
          activityEmoji: '💎',
          activityText: 'Toque músicas de alta definição'
        });
      }

      // Aplica o status e a atividade recuperados do banco de dados no bot de forma unificada
      client.user.setPresence({
        status: settings.status,
        activities: [{
          name: 'custom',
          type: ActivityType.Custom,
          state: `${settings.activityEmoji} ${settings.activityText}`
        }]
      });

      console.log('[PRESENÇA] Status e atividade aplicados com sucesso.');
    } catch (error) {
      console.error('[ERRO PRESENÇA] Falha ao carregar as configurações de status do banco de dados:', error);
    }
  },
};
