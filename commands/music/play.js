const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');
const User = require('../../models/User');
const { queues, createQueue, deleteQueue } = require('../../utils/musicManager');

// Função auxiliar de proteção para evitar que o bot fique travado infinitamente se o YouTube demorar para responder
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

    // Informa ao Discord que o bot está processando o comando (Inicia o "está pensando...")
    await interaction.deferReply();

    // VALIDAÇÃO DE USUÁRIO VIP NO BANCO DE DADOS
    const dbUser = await User.findOne({ discordId: interaction.user.id });
    const isUserVip = dbUser && dbUser.isVip;

    if (!isUserVip) {
      const checkoutUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
      const vipEmbed = new EmbedBuilder()
        .setTitle('💎 Canal Exclusivo VIP')
        .setDescription('A reprodução de áudio em canais de voz é um benefício exclusivo para assinantes VIP.\n\nAssine agora mesmo pelo painel para liberar o player do Quasar!')
        .setColor('#3b82f6')
        .addFields({ name: 'Assine em:', value: `[Painel Quasar](${checkoutUrl.replace(/\/$/, '')}/dashboard)` });

      // Edita a resposta original e limpa o "está pensando..."
      return interaction.editReply({ embeds: [vipEmbed] });
    }

    const query = options.getString('busca');

    try {
      let ytInfo;
      const type = play.yt_validate(query);

      if (type === 'video') {
        // Carrega informações do link do vídeo com timeout limite de 8 segundos
        ytInfo = await withTimeout(
          play.video_info(query),
          8000,
          'O servidor do YouTube demorou muito para responder a este link (tempo limite excedido).'
        );
      } else {
        // Busca de termos de texto com timeout de 8 segundos para evitar travamentos
        const searchResults = await withTimeout(
          play.search(query, { limit: 1 }),
          8000,
          'A busca expirou devido a lentidão de resposta dos servidores de pesquisa do YouTube.'
        );

        if (!searchResults || searchResults.length === 0) {
          return interaction.editReply({ content: 'Nenhum resultado de música correspondente foi encontrado para a sua busca.' });
        }
        
        // Obtém detalhes do vídeo selecionado com timeout
        ytInfo = await withTimeout(
          play.video_info(searchResults[0].url),
          8000,
          'Falha ao obter metadados da música selecionada (tempo limite excedido).'
        );
      }

      const song = {
        title: ytInfo.video_details.title,
        url: ytInfo.video_details.url,
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
        
        // Executa o carregamento assíncrono do player de áudio
        await playSong(guild.id, song);

        const playEmbed = new EmbedBuilder()
          .setTitle('🎶 Tocando Agora')
          .setDescription(`**[${song.title}](${song.url})**\nDuração: \`${song.duration}\``)
          .setThumbnail(song.thumbnail)
          .setColor('#3b82f6');

        // Remove o status de carregamento e exibe o painel de reprodução
        return interaction.editReply({ embeds: [playEmbed] });
      } else {
        serverQueue.songs.push(song);
        return interaction.editReply({ content: `Adicionado à fila de reprodução: **${song.title}**` });
      }

    } catch (err) {
      console.error('[ERRO PLAY COMMAND]', err);
      const errorMsg = err.message || 'Lentidão detectada ou falha temporária de conexão.';
      // Remove o "está pensando..." e avisa o erro de forma limpa no chat
      return interaction.editReply({ content: `❌ **Falha ao reproduzir áudio**: ${errorMsg}` });
    }
  }
};

async function playSong(guildId, song) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (!song) {
    if (!queue.is247) {
      deleteQueue(guildId);
    }
    return;
  }

  try {
    // Carrega o stream da música com proteção limite de 10 segundos para não travar o bot
    const stream = await withTimeout(
      play.stream(song.url),
      10000,
      'A geração do stream de áudio expirou (lentidão na rede ou bloqueio de IP temporário do YouTube).'
    );

    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    
    queue.player.play(resource);

    queue.player.once(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      playSong(guildId, queue.songs[0]);
    });

  } catch (error) {
    console.error('[ERRO STREAMING]', error);
    // Envia alerta de erro no canal e passa para a próxima música da fila
    queue.textChannel.send(`⚠️ Falha ao carregar a faixa **${song.title}**: ${error.message}`);
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
  }
}
