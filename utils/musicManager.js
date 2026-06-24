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

// Centralização do playSong com filtro preventivo contra URLs inválidas
async function playSong(guildId, song) {
  const queue = queues.get(guildId);
  if (!queue) return;

  // CORREÇÃO: Filtro de segurança contra URLs inválidas ou indefinidas
  if (!song || !song.url || song.url === 'undefined' || song.url.includes('undefined')) {
    queue.textChannel.send('⚠️ URL de reprodução corrompida ou inválida detectada. Avançando para a próxima música da fila.');
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
    return;
  }

  try {
    const stream = await Promise.race([
      play.stream(song.url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido ao obter stream de áudio')), 12000))
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
    console.error('[ERRO STREAMING]', error);
    queue.textChannel.send(`⚠️ Falha ao transmitir a música **${song.title}**: ${error.message || 'Lentidão temporária do YouTube.'}`);
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
  }
}

module.exports = { queues, getQueue, createQueue, deleteQueue, playSong };
