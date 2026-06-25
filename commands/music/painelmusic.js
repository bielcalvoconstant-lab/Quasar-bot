const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { queues } = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painelmusic')
    .setDescription('Abre o painel interativo de controle da fila de música.'),

  async execute(interaction) {
    const { guild, member } = interaction;
    const serverQueue = queues.get(guild.id);

    if (!member.voice.channel) {
      return interaction.reply({ content: 'Você precisa estar no canal de voz para ver o painel.', ephemeral: true });
    }

    if (!serverQueue) {
      return interaction.reply({ content: 'Nenhuma música está tocando no momento neste servidor.', ephemeral: true });
    }

    const currentSong = serverQueue.songs[0];

    const embed = new EmbedBuilder()
      .setTitle('🎮 Painel de Controle - Quasar Music')
      .setDescription(`Música Atual: **[${currentSong.title}](${currentSong.url})**\nDuração: \`${currentSong.duration}\`\n\nModo 24/7: ${serverQueue.is247 ? '🟢 Ativado (Bot permanecerá no canal)' : '🔴 Desativado'}`)
      .setThumbnail(currentSong.thumbnail)
      .setColor('#3b82f6')
      .setFooter({ text: 'Gerencie a fila usando as interações abaixo.' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('quasar_music_pause')
          .setLabel('Pausar/Retomar')
          .setEmoji('⏯️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('quasar_music_skip')
          .setLabel('Pular')
          .setEmoji('⏭️')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('quasar_music_stop')
          .setLabel('Parar')
          .setEmoji('⏹️')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('quasar_music_queue')
          .setLabel('Ver Fila')
          .setEmoji('📜')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('quasar_music_247')
          .setLabel('Modo 24/7 (VIP)')
          .setEmoji('♾️')
          .setStyle(ButtonStyle.Secondary)
      );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
};