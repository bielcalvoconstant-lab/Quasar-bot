const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer } = require('@discordjs/voice');
const play = require('play-dl');
const User = require('../../models/User');
const { queues, createQueue, playSong } = require('../../utils/musicManager');

function withTimeout(promise, ms, errorMessage = 'Tempo limite excedido na requisição.') {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), ms)
  );
  return Promise.race([promise, timeout]);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma música do YouTube/Spotify no canal de voz (VIP).')
    .addStringOption(option =>
      option.setName('busca')
        .setDescription('Nome da música ou link de reprodução')
        .setRequired(true)),

  async execute(interaction) {
    const { member, guild, options } = interaction;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({ content: 'Você precisa estar em um canal de voz para tocar músicas.', ephemeral: true });
    }

    await interaction.deferReply();

    const dbUser = await User.findOne({ discordId: interaction.user.id });
    const isUserVip = dbUser && dbUser.isVip;

    if (!isUserVip) {
      const checkoutUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
      const vipEmbed = new EmbedBuilder()
        .setTitle('💎 Canal Exclusivo VIP')
        .setDescription('A reprodução de áudio em canais de voz é um benefício exclusivo para assinantes VIP.\n\nAssine agora mesmo pelo painel para liberar o player do Quasar!')
        .setColor('#3b82f6')
        .addFields({ name: 'Assine em:', value: `[Painel Quasar](${checkoutUrl.replace(/\/$/, '')}/dashboard)` });

      return interaction.editReply({ embeds: [vipEmbed] });
    }

    const query = options.getString('busca');

    try {
      let ytInfo = null;
      let finalUrl = null; // Garante que a URL final seja sempre salva e nunca fique undefined
      const isSpotify = play.sp_validate(query);

      // CONVERSÃO DE SPOTIFY PARA YOUTUBE
      if (isSpotify && isSpotify !== 'search') {
        try {
          const spotifyData = await play.spotify(query);
          if (isSpotify === 'track') {
            const searchQuery = `${spotifyData.name} - ${spotifyData.artists.map(a => a.name).join(' ')}`;
            const searchResults = await withTimeout(
              play.search(searchQuery, { limit: 1 }),
              8000,
              'A busca da faixa correspondente do Spotify expirou.'
            );
            if (!searchResults || searchResults.length === 0) {
              return interaction.editReply({ content: 'Não encontramos nenhuma versão compatível no YouTube para essa música do Spotify.' });
            }
            finalUrl = searchResults[0].url; // Captura a URL real do vídeo do YouTube retornado pela busca
            ytInfo = await withTimeout(
              play.video_info(finalUrl),
              8000,
              'Tempo limite excedido ao carregar os dados do YouTube para a faixa do Spotify.'
            );
          } else {
            return interaction.editReply({ content: 'No momento, suportamos apenas faixas individuais (Tracks) de links do Spotify.' });
          }
        } catch (spErr) {
          console.error(spErr);
          return interaction.editReply({ content: 'Falha ao processar o link do Spotify. Verifique se a música é pública.' });
        }
      } else if (play.yt_validate(query) === 'video') {
        finalUrl = query; // Link direto do YouTube enviado pelo usuário
        ytInfo = await withTimeout(
          play.video_info(query),
          8000,
          'O servidor do YouTube demorou muito para responder a este link.'
        );
      } else {
        // Busca de texto do YouTube
        const searchResults = await withTimeout(
          play.search(query, { limit: 1 }),
          8000,
          'A busca expirou devido à lentidão de resposta dos servidores do YouTube.'
        );

        if (!searchResults || searchResults.length === 0) {
          return interaction.editReply({ content: 'Nenhum resultado de música correspondente foi encontrado.' });
        }
        
        finalUrl = searchResults[0].url; // Captura a URL do primeiro vídeo retornado pela busca de texto
        ytInfo = await withTimeout(
          play.video_info(finalUrl),
          8000,
          'Falha ao obter metadados da música selecionada.'
        );
      }

      // CORREÇÃO: Usamos a finalUrl que está 100% preenchida com um link do YouTube válido
      const song = {
        title: ytInfo.video_details.title,
        url: finalUrl, 
        duration: ytInfo.video_details.durationRaw,
        thumbnail: ytInfo.video_details.thumbnails[0]?.url || ''
      };

      let serverQueue = queues.get(guild.id);

      if (!serverQueue) {
        serverQueue = createQueue(guild.id, interaction.channel, voiceChannel);

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();

        serverQueue.connection = connection;
        serverQueue.player = player;
        connection.subscribe(player);

        serverQueue.songs.push(song);
        
        await playSong(guild.id, song);

        const playEmbed = new EmbedBuilder()
          .setTitle('🎶 Tocando Agora')
          .setDescription(`**[${song.title}](${song.url})**\nDuração: \`${song.duration}\``)
          .setThumbnail(song.thumbnail)
          .setColor('#3b82f6');

        return interaction.editReply({ embeds: [playEmbed] });
      } else {
        serverQueue.songs.push(song);
        return interaction.editReply({ content: `Adicionado à fila de reprodução: **${song.title}**` });
      }

    } catch (err) {
      console.error('[ERRO PLAY COMMAND]', err);
      return interaction.editReply({ content: `❌ **Falha ao reproduzir áudio**: ${err.message || 'Lentidão temporária do YouTube.'}` });
    }
  }
};
