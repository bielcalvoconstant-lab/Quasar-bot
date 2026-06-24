const { Events, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { queues, deleteQueue } = require('../utils/musicManager');
const User = require('../models/User');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    
    // 1. COMANDOS SLASH (/)
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

    // 2. INTERAÇÃO DE BOTÕES
    if (interaction.isButton()) {
      const { customId, guild, member } = interaction;

      // ==========================================
      // 🎫 SISTEMA DE TICKET (ABRIR E FECHAR TICKET)
      // ==========================================
      
      // Abrir um Ticket Privado
      if (customId === 'quasar_open_ticket') {
        await interaction.deferReply({ ephemeral: true });

        const ticketChannelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        // Verifica se o canal de ticket já foi criado no servidor para evitar spam
        const existingChannel = guild.channels.cache.find(c => c.name === ticketChannelName);
        if (existingChannel) {
          return interaction.editReply({ content: `Você já possui um canal de atendimento aberto em: ${existingChannel}` });
        }

        try {
          // Cria o canal com permissões privadas
          const ticketChannel = await guild.channels.create({
            name: ticketChannelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel], // Esconde o canal de todos
              },
              {
                id: interaction.user.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.AttachFiles
                ], // Permite o acesso do usuário do ticket
              }
            ],
          });

          const ticketEmbed = new EmbedBuilder()
            .setTitle('🎫 Suporte Iniciado')
            .setDescription(`Olá ${interaction.user}, bem-vindo ao seu ticket de suporte.\nNossa equipe foi notificada e entrará em contato em breve.\n\nPara encerrar o suporte, clique no botão de fechar abaixo.`)
            .setColor('#10b981')
            .setTimestamp();

          const ticketRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('quasar_close_ticket')
                .setLabel('Fechar Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger)
            );

          await ticketChannel.send({ embeds: [ticketEmbed], components: [ticketRow] });
          return interaction.editReply({ content: `Seu canal de suporte foi criado com sucesso: ${ticketChannel}` });

        } catch (err) {
          console.error('[ERRO TICKET CREATE]', err);
          return interaction.editReply({ content: 'Houve um erro no servidor ao tentar criar o seu canal de ticket.' });
        }
      }

      // Fechar e Excluir o Canal de Ticket
      if (customId === 'quasar_close_ticket') {
        await interaction.reply({ content: 'Este canal de ticket será removido em 5 segundos...' });
        
        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (err) {
            console.error('[ERRO TICKET DELETE]', err);
          }
        }, 5000);
        return;
      }

      // ==========================================
      // 🎶 SISTEMA DE PLAYER DE MÚSICA
      // ==========================================
      const serverQueue = queues.get(guild.id);

      if (!member.voice.channel) {
        return interaction.reply({ content: 'Você precisa estar em um canal de voz para interagir com o painel de som.', ephemeral: true });
      }

      if (!serverQueue) {
        return interaction.reply({ content: 'Nenhum player ativo localizado.', ephemeral: true });
      }

      if (customId === 'quasar_music_247') {
        const dbUser = await User.findOne({ discordId: interaction.user.id });
        if (!dbUser || !dbUser.isVip) {
          return interaction.reply({ content: '❌ O recurso **Modo 24/7** é exclusivo para assinantes VIP.', ephemeral: true });
        }

        serverQueue.is247 = !serverQueue.is247;
        await interaction.reply({ content: `♾️ Modo 24/7 foi **${serverQueue.is247 ? 'Ativado' : 'Desativado'}** por ${interaction.user.username}.` });

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
          serverQueue.player.stop();
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
            .setTitle('📜 Fila do Reprodutor')
            .setDescription(queueList || 'Não há músicas adicionais na fila.')
            .setColor('#3b82f6');
            
          return interaction.reply({ embeds: [queueEmbed], ephemeral: true });

        default:
          break;
      }
    }
  }
};