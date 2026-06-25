const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
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

// CORREÇÃO: Formata a duração retornada pelo SoundCloud com proteção contra valores vazios/nulos
function formatDuration(duration) {
  if (typeof duration === 'string') return duration;
  if (!duration || isNaN(duration)) return '3:30'; // Fallback padrão amigável caso o SoundCloud retorne nulo
  
  const totalSeconds = Math.floor(duration / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  
  const sStr = seconds < 10 ? `0${seconds}` : seconds;
  const mStr = minutes < 10 ? `0${minutes}` : minutes;
  
  if (hours > 0) {
    return `${hours}:${mStr}:${sStr}`;
  }
  return `${minutes}:${sStr}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Busca e toca músicas do SoundCloud/Spotify no canal de voz (VIP).')
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
      const isSpotify = play.sp_validate(query);
      const isSoundcloudLink = query.includes('soundcloud.com');

      // ===================================================
      // 🚀 FLUXO DE LINKS DO SPOTIFY
      // ===================================================
      if (isSpotify && isSpotify === 'track') {
        try {
          const spotifyData = await play.spotify(query);
          const searchQuery = `${spotifyData.name} - ${spotifyData.artists.map(a => a.name).join(' ')}`;
          
          const searchResults = await play.search(searchQuery, { source: { soundcloud: 'tracks' }, limit: 1 });
          if (!searchResults || searchResults.length === 0) {
            return interaction.editReply({ content: 'Não encontramos nenhuma versão compatível no SoundCloud para essa música do Spotify.' });
          }

          const song = {
            title: searchResults[0].name || searchResults[0].title,
            url: searchResults[0].url,
            duration: formatDuration(searchResults[0].duration),
            thumbnail: searchResults[0].thumbnail || ''
          };

          await handlePlay(interaction, guild, voiceChannel, song);
          return;

        } catch (spErr) {
          console.warn('[SPOTIFY CREDENTIALS MISSING]', spErr.message);
          return interaction.editReply({ 
            content: '⚠️ O suporte a links diretos do Spotify requer credenciais de desenvolvedor (`SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`) cadastradas no Railway.\n\n👉 **Solução**: Faça a busca digitando apenas o **nome da música**! (Ex: `/play m4`).' 
          });
        }
      }

      // ===================================================
      // 🔍 FLUXO GERAL DO SOUNDCLOUD (Busca e Links Diretos)
      // ===================================================
      const searchResults = await withTimeout(
        play.search(query, { source: { soundcloud: 'tracks' }, limit: 5 }),
        8000,
        'A busca de faixas no SoundCloud expirou.'
      );

      if (!searchResults || searchResults.length === 0) {
        return interaction.editReply({ content: 'Nenhum resultado de música correspondente foi encontrado no SoundCloud.' });
      }

      if (isSoundcloudLink) {
        const selectedTrack = searchResults[0];
        const song = {
          title: selectedTrack.name || selectedTrack.title,
          url: selectedTrack.url,
          duration: formatDuration(selectedTrack.duration),
          thumbnail: selectedTrack.thumbnail || ''
        };
        await handlePlay(interaction, guild, voiceChannel, song);
        return;
      }

      await renderSelectionMenu(interaction, guild, voiceChannel, searchResults);

    } catch (err) {
      console.error('[ERRO PLAY COMMAND GERAL]', err);
      return interaction.editReply({ content: `❌ **Falha ao reproduzir áudio**: ${err.message || 'Lentidão temporária do SoundCloud.'}` });
    }
  }
};

// ===================================================
// 🛠️ FUNÇÕES AUXILIARES DE EXECUÇÃO
// ===================================================

async function handlePlay(interaction, guild, voiceChannel, song) {
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
      .setColor('#3b82f6');

    return interaction.editReply({ embeds: [playEmbed] });
  } else {
    serverQueue.songs.push(song);
    return interaction.editReply({ content: `Adicionado à fila de reprodução: **${song.title}**` });
  }
}

async function renderSelectionMenu(interaction, guild, voiceChannel, searchResults) {
  const embed = new EmbedBuilder()
    .setTitle('🔍 Seleção de Músicas - Quasar')
    .setDescription('Selecione uma das 5 melhores faixas encontradas no menu abaixo para tocar:')
    .setColor('#3b82f6')
    .setFooter({ text: 'Menu expira em 30 segundos.' });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('quasar_play_select')
    .setPlaceholder('Escolha uma das faixas para tocar...');

  searchResults.forEach((track, index) => {
    const title = track.name || track.title || 'Faixa sem título';
    const durationStr = formatDuration(track.duration);
    
    embed.addFields({ 
      name: `${index + 1}. ${title}`, 
      value: `Duração: \`${durationStr}\` • [Link](${track.url})` 
    });

    selectMenu.addOptions({
      label: `${index + 1}. ${title.substring(0, 80)}`,
      value: index.toString(),
      description: `Duração: ${durationStr}`
    });
  });

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const response = await interaction.editReply({ embeds: [embed], components: [row] });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 30000
  });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'Você não pode escolher músicas na busca de outro usuário.', ephemeral: true });
    }

    await i.deferUpdate();

    const selectedIndex = parseInt(i.values[0]);
    const selectedTrack = searchResults[selectedIndex];

    const song = {
      title: selectedTrack.name || selectedTrack.title,
      url: selectedTrack.url,
      duration: formatDuration(selectedTrack.duration),
      thumbnail: selectedTrack.thumbnail || ''
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
        .setColor('#3b82f6');

      await i.editReply({ embeds: [playEmbed], components: [] });
    } else {
      serverQueue.songs.push(song);
      await i.editReply({ content: `Adicionado à fila de reprodução: **${song.title}**`, embeds: [], components: [] });
    }

    collector.stop();
  });

  collector.on('end', collected => {
    if (collected.size === 0) {
      interaction.editReply({ content: 'Tempo de seleção expirado.', embeds: [], components: [] }).catch(() => null);
    }
  });
}