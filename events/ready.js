const { ActivityType } = require('discord.js');
const BotSettings = require('../models/BotSettings');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[QUASAR BOT] Logado com sucesso como ${client.user.tag}`);

    try {
      // Carrega ou inicializa as configurações padrão do bot
      let settings = await BotSettings.findOne({ key: 'global_config' });
      if (!settings) {
        settings = await BotSettings.create({ key: 'global_config' });
      }

      // Aplica a presença com base no banco de dados
      const presenceConfig = {
        status: settings.status,
        activities: []
      };

      if (settings.activityText) {
        presenceConfig.activities.push({
          name: settings.activityText,
          type: ActivityType.Custom,
          state: `${settings.activityEmoji ? settings.activityEmoji + ' ' : ''}${settings.activityText}`
        });
      }

      client.user.setPresence(presenceConfig);
      console.log('[PRESENÇA] Status e atividade aplicados com sucesso.');

    } catch (error) {
      console.error('[ERRO PRESENÇA] Erro ao restaurar configurações do bot:', error);
    }
  }
};
