const { createAudioPlayer, createAudioResource, joinVoiceChannel, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');

const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guildId, textChannel, voiceChannel) {
  const queue = {
    textChannel,
    voiceChannel,
    connection: null,
    player: null,
    songs: [],
    volume: 0.5,
    playing: true,
    is247: false,
  };
  queues.set(guildId, queue);
  return queue;
}

function deleteQueue(guildId) {
  const queue = queues.get(guildId);
  if (queue) {
    if (queue.connection) {
      try {
        queue.connection.destroy();
      } catch (e) {
        console.error(e);
      }
    }
    queues.delete(guildId);
  }
}

// Transmissão direta e exclusiva do SoundCloud
async function playSong(guildId, song) {
  const queue = queues.get(guildId);
  if (!queue) return;

  // PROTEÇÃO DE FIM DE FILA: Encerra se a fila acabar
  if (!song) {
    if (!queue.is247) {
      deleteQueue(guildId);
    }
    return;
  }

  // FILTRO DE SEGURANÇA: Cancela URLs nulas/indefinidas
  if (!song.url || song.url === 'undefined' || song.url.includes('undefined')) {
    queue.textChannel.send('⚠️ URL de reprodução inválida detectada. Avançando para a próxima música da fila.');
    queue.songs.shift();
    
    setImmediate(() => {
      playSong(guildId, queue.songs[0]);
    });
    return;
  }

  try {
    // Faz o carregamento do stream diretamente do SoundCloud com tempo limite de segurança
    const stream = await Promise.race([
      play.stream(song.url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido ao obter stream de áudio do SoundCloud.')), 12000))
    ]);

    const resource = createAudioResource(stream.stream, { 
      inputType: stream.type,
      inlineVolume: true 
    });
    
    if (resource.volume) {
      resource.volume.setVolume(queue.volume);
    }
    
    queue.player.play(resource);

    queue.player.once(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      playSong(guildId, queue.songs[0]);
    });

  } catch (error) {
    console.error('[ERRO STREAMING SOUNDCLOUD]', error);
    queue.textChannel.send(`⚠️ Falha ao transmitir a música **${song.title}**: ${error.message || 'Lentidão na rede.'}`);
    queue.songs.shift();
    
    // Libera a pilha de execução (Call Stack) do Node para evitar estouro de memória
    setImmediate(() => {
      playSong(guildId, queue.songs[0]);
    });
  }
}

module.exports = { queues, getQueue, createQueue, deleteQueue, playSong };
