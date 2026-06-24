const { Events, EmbedBuilder } = require('discord.js');
const { queues, deleteQueue } = require('../utils/musicManager');
const User = require('../models/User');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    
    // 1. PROCESSAMENTO DE COMANDOS SLASH
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Houve um erro ao executar este comando!', ephemeral: true });
        } else {
          await interaction.reply({ content: 'Houve um erro ao executar este comando!', ephemeral: true });
        }
      }
    }

    // 2. PROCESSAMENTO DOS BOTÕES INTERATIVOS DO PAINEL DE MÚSICA
    if (interaction.isButton()) {
      const { customId, guild, member } = interaction;
      const serverQueue = queues.get(guild.id);

      if (!member.voice.channel) {
        return interaction.reply({ content: 'Você precisa estar em um canal de voz para interagir com os botões.', ephemeral: true });
      }

      if (!serverQueue) {
        return interaction.reply({ content: 'Nenhum reprodutor ativo encontrado.', ephemeral: true });
      }

      // Validação do botão de ativação de transmissão ininterrupta (24/7) reservada a VIPs
      if (customId === 'quasar_music_247') {
        const dbUser = await User.findOne({ discordId: interaction.user.id });
        if (!dbUser || !dbUser.isVip) {
          return interaction.reply({ content: '❌ O recurso **Modo 24/7** é exclusivo para assinantes VIP.', ephemeral: true });
        }

        serverQueue.is247 = !serverQueue.is247;
        await interaction.reply({ content: `♾️ Modo 24/7 foi **${serverQueue.is247 ? 'Ativado' : 'Desativado'}** por ${interaction.user.username}.` });

        // Atualiza dinamicamente a Embed do painel
        try {
          const currentSong = serverQueue.songs[0];
          const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setDescription(`Música Atual: **[${currentSong.title}](${currentSong.url})**\nDuração: \`${currentSong.duration}\`\n\nModo 24/7: ${serverQueue.is247 ? '🟢 Ativado (Bot permanecerá no canal)' : '🔴 Desativado'}`);
          await interaction.message.edit({ embeds: [updatedEmbed] });
        } catch (e) {
          console.error(e.message);
        }
        return;
      }

      // Outras ações do painel
      switch (customId) {
        case 'quasar_music_pause':
          if (serverQueue.playing) {
            serverQueue.player.pause();
            serverQueue.playing = false;
            return interaction.reply({ content: `⏸️ Música pausada por ${interaction.user.username}.` });
          } else {
            serverQueue.player.unpause();
            serverQueue.playing = true;
            return interaction.reply({ content: `▶️ Música retomada por ${interaction.user.username}.` });
          }

        case 'quasar_music_skip':
          serverQueue.player.stop(); // Interrompe o áudio atual para acionar o próximo da fila no evento Idle
          return interaction.reply({ content: `⏭️ Música pulada por ${interaction.user.username}.` });

        case 'quasar_music_stop':
          deleteQueue(guild.id);
          return interaction.reply({ content: `⏹️ Reprodução parada e fila limpa por ${interaction.user.username}.` });

        case 'quasar_music_queue':
          const queueList = serverQueue.songs
            .map((song, index) => `${index + 1}. **${song.title}** (\`${song.duration}\`)`)
            .slice(0, 10)
            .join('\n');
            
          const queueEmbed = new EmbedBuilder()
            .setTitle('📜 Fila do Reprodutor (Top 10)')
            .setDescription(queueList || 'Não há músicas adicionais na fila.')
            .setColor('#3b82f6');
            
          return interaction.reply({ embeds: [queueEmbed], ephemeral: true });

        default:
          break;
      }
    }
  }
};