const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Envia o painel interativo de suporte (Ticket) neste canal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🎫 Central de Atendimento')
      .setDescription('Precisa falar com nossa equipe? Clique no botão abaixo para abrir um canal de suporte privado e exclusivo.')
      .setColor('#3b82f6')
      .setFooter({ text: 'Sistema de Suporte Quasar' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('quasar_open_ticket')
          .setLabel('Abrir Ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.reply({ content: 'Painel de tickets configurado com sucesso neste canal.', ephemeral: true });
    await interaction.channel.send({ embeds: [embed], components: [row] });
  }
};
