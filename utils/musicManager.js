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
    volume: 0.5, // Volume inicial (50%)
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

// Centralização do playSong para que seja acessível pelo Bot (/play) e pelo Dashboard Web
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
    const stream = await Promise.race([
      play.stream(song.url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido ao obter stream de áudio')), 12000))
    ]);

    // O inlineVolume: true é estritamente necessário para permitir alteração de volume via código/site!
    const resource = createAudioResource(stream.stream, { 
      inputType: stream.type,
      inlineVolume: true 
    });
    
    // Aplica o volume atualmente configurado na fila
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
    queue.textChannel.send(`⚠️ Falha ao transmitir a música **${song.title}**: ${error.message}`);
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
  }
}

module.exports = { queues, getQueue, createQueue, deleteQueue, playSong };
