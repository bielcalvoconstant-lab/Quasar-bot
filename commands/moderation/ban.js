const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bane um membro do servidor com registro de log.')
    .addUserOption(option => 
      option.setName('usuario')
        .setDescription('O usuário a ser banido')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('motivo')
        .setDescription('Motivo do banimento')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers), // Restringe nativamente para quem tem permissão de banir

  async execute(interaction) {
    const { guild, options, user } = interaction;
    const targetUser = options.getUser('usuario');
    const reason = options.getString('motivo') || 'Nenhum motivo fornecido.';

    await interaction.deferReply({ ephemeral: true });

    try {
      const memberToBan = await guild.members.fetch(targetUser.id).catch(() => null);

      if (memberToBan) {
        // Valida se o bot pode punir o usuário (hierarquia de cargos)
        if (!memberToBan.bannable) {
          return interaction.editReply({ content: 'Eu não tenho permissões suficientes para banir este membro devido à hierarquia de cargos.' });
        }
      }

      // Executa o banimento no servidor
      await guild.members.ban(targetUser.id, { reason });

      // Busca as configurações de logs salvas no MongoDB para este servidor
      const config = await GuildConfig.findOne({ guildId: guild.id });

      const logEmbed = new EmbedBuilder()
        .setTitle('🚨 Membro Banido')
        .setColor('#ef4444')
        .addFields(
          { name: 'Membro', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
          { name: 'Moderador', value: `${user.tag}`, inline: true },
          { name: 'Motivo', value: reason }
        )
        .setTimestamp();

      // Se houver canal de logs configurado, envia o relatório para lá
      if (config && config.logChannelId) {
        const logChannel = await guild.channels.fetch(config.logChannelId).catch(() => null);
        if (logChannel) {
          await logChannel.send({ embeds: [logEmbed] });
        }
      }

      return interaction.editReply({ content: `O usuário **${targetUser.tag}** foi banido com sucesso.` });

    } catch (error) {
      console.error('[ERRO BAN]', error);
      return interaction.editReply({ content: 'Houve um erro ao processar o banimento deste usuário.' });
    }
  }
};
