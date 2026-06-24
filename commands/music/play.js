const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');
const User = require('../../models/User');
const { queues, createQueue, deleteQueue } = require('../../utils/musicManager');

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

    // VALIDAÇÃO DE USUÁRIO VIP NO BANCO DE DADOS
    const dbUser = await User.findOne({ discordId: interaction.user.id });
    const isUserVip = dbUser && dbUser.isVip;

    if (!isUserVip) {
      const checkoutUrl = process.env.DISCORD_REDIRECT_URI.replace('/auth/discord/callback', '/dashboard');
      const vipEmbed = new EmbedBuilder()
        .setTitle('💎 Canal Exclusivo VIP')
        .setDescription('A reprodução de áudio em canais de voz é um benefício exclusivo para assinantes VIP.\n\nAssine agora mesmo pelo painel para liberar o player do Quasar!')
        .setColor('#3b82f6')
        .addFields({ name: 'Assine em:', value: `[Painel Quasar](${checkoutUrl})` });

      return interaction.editReply({ embeds: [vipEmbed] });
    }

    const query = options.getString('busca');

    try {
      let ytInfo;
      if (play.yt_validate(query) === 'video') {
        ytInfo = await play.video_info(query);
      } else {
        const searchResults = await play.search(query, { limit: 1 });
        if (searchResults.length === 0) {
          return interaction.editReply({ content: 'Nenhum resultado encontrado para a sua busca.' });
        }
        ytInfo = await play.video_info(searchResults[0].url);
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
        playSong(guild.id, song);

        const playEmbed = new EmbedBuilder()
          .setTitle('🎶 Tocando Agora')
          .setDescription(`**[${song.title}](${song.url})**\nDuração: \`${song.duration}\``)
          .setThumbnail(song.thumbnail)
          .setColor('#3b82f6');

        return interaction.editReply({ embeds: [playEmbed] });
      } else {
        serverQueue.songs.push(song);
        return interaction.editReply({ content: `Adicionado à fila: **${song.title}**` });
      }

    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: 'Houve um erro ao processar a música.' });
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
    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    
    queue.player.play(resource);

    queue.player.once(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      playSong(guildId, queue.songs[0]);
    });

  } catch (error) {
    console.error(error);
    queue.textChannel.send('Falha ao transmitir o stream de áudio.');
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
  }
          }
