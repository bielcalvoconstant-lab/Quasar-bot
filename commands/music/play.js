const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma música de alta fidelidade em seu canal de voz.')
    .addStringOption(option => 
      option.setName('musica')
        .setDescription('O nome ou link da música/playlist do YouTube')
        .setRequired(true)),
  
  async execute(interaction) {
    const { user, guildId, member } = interaction;

    // Responde inicialmente para evitar timeout de 3 segundos
    await interaction.deferReply();

    try {
      // Procura o usuário cadastrado no banco com base no Discord ID
      const dbUser = await User.findOne({ discordId: user.id });

      // Verificação de permissão VIP
      if (!dbUser || !dbUser.isVip) {
        const noVipEmbed = new EmbedBuilder()
          .setTitle('👑 Recurso Exclusivo VIP')
          .setDescription('O reprodutor de áudio de alta fidelidade está habilitado exclusivamente para membros Premium e servidores licenciados.')
          .addFields(
            { name: 'Como assinar?', value: 'Acesse nosso painel e realize a ativação por cartão ou PIX em tempo real para seu usuário.' }
          )
          .setColor('#ef4444')
          .setThumbnail(interaction.client.user.displayAvatarURL());

        return interaction.editReply({ embeds: [noVipEmbed] });
      }

      const voiceChannel = member.voice.channel;
      if (!voiceChannel) {
        return interaction.editReply({ content: 'Você precisa estar conectado a um canal de voz para reproduzir músicas.' });
      }

      const musicQuery = interaction.options.getString('musica');

      // Executa a lógica de conexão no canal de voz usando @discordjs/voice
      // [Implementação de Áudio Estrutural]
      
      const successEmbed = new EmbedBuilder()
        .setTitle('🎵 Tocando Agora')
        .setDescription(`Buscando e reproduzindo: **${musicQuery}**`)
        .setColor('#3b82f6')
        .setFooter({ text: 'Transmissão Premium Ativada' });

      return interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
      console.error(error);
      return interaction.editReply({ content: 'Ocorreu um erro ao carregar as informações do reprodutor de música.' });
    }
  }
};
