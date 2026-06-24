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

// Centralização do playSong com segurança recursiva de eventos
async function playSong(guildId, song) {
  const queue = queues.get(guildId);
  if (!queue) return;

  // 1. PROTEÇÃO DE FIM DE FILA: Se não houver mais músicas, encerra e sai de forma limpa
  if (!song) {
    if (!queue.is247) {
      deleteQueue(guildId);
    }
    return;
  }

  // 2. FILTRO DE URL: Se a música existe mas o link está quebrado, avança para a próxima
  if (!song.url || song.url === 'undefined' || song.url.includes('undefined')) {
    queue.textChannel.send('⚠️ URL de reprodução corrompida ou inválida detectada. Avançando para a próxima música da fila.');
    queue.songs.shift();
    
    // O setImmediate libera a call stack do Node, evitando o estouro de memória (RangeError)
    setImmediate(() => {
      playSong(guildId, queue.songs[0]);
    });
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
    queue.textChannel.send(`⚠️ Falha ao transmitir a música **${song.title}**: ${error.message || 'Conexão interrompida.'}`);
    queue.songs.shift();
    
    // Libera a pilha de execução em caso de erros consecutivas no stream
    setImmediate(() => {
      playSong(guildId, queue.songs[0]);
    });
  }
}

module.exports = { queues, getQueue, createQueue, deleteQueue, playSong };
