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

// Centralização do playSong com suporte a Fallback automático via SoundCloud em caso de bloqueio regional do YouTube
async function playSong(guildId, song) {
  const queue = queues.get(guildId);
  if (!queue) return;

  // 1. PROTEÇÃO DE FIM DE FILA: Se não houver mais músicas, encerra de forma limpa
  if (!song) {
    if (!queue.is247) {
      deleteQueue(guildId);
    }
    return;
  }

  // 2. FILTRO DE URL: Se a música possui um link inválido de origem, avança para a próxima
  if (!song.url || song.url === 'undefined' || song.url.includes('undefined')) {
    queue.textChannel.send('⚠️ URL de reprodução inválida detectada. Avançando para a próxima música da fila.');
    queue.songs.shift();
    
    setImmediate(() => {
      playSong(guildId, queue.songs[0]);
    });
    return;
  }

  try {
    // Tenta transmitir o áudio do YouTube usando o cookie cadastrado no Railway
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
    console.error('[ERRO STREAMING - YOUTUBE BLOQUEADO]', error.message);

    // ===================================================
    // 📻 SISTEMA DE FALLBACK AUTOMÁTICO DE ALTA FIDELIDADE
    // ===================================================
    // Se o erro for bloqueio do YouTube (ERR_INVALID_URL ou Sign in), acionamos o SoundCloud
    if (song.url.includes('youtube.com') || song.url.includes('youtu.be') || error.code === 'ERR_INVALID_URL' || error.message?.includes('confirm you\'re not a bot')) {
      try {
        queue.textChannel.send(`🔍 *Bloqueio regional do YouTube detectado. Buscando versão alternativa de alta fidelidade para **${song.title}** no SoundCloud...*`);
        
        // Busca a faixa equivalente no banco do SoundCloud sem necessidade de chaves de API
        const scResults = await play.search(song.title, { source: { soundcloud: 'tracks' }, limit: 1 });
        
        if (scResults && scResults.length > 0) {
          // Obtém o stream estável do SoundCloud (100% imune a bloqueios em servidores cloud)
          const scStream = await play.stream(scResults[0].url);
          
          const resource = createAudioResource(scStream.stream, { 
            inputType: scStream.type,
            inlineVolume: true 
          });
          
          if (resource.volume) {
            resource.volume.setVolume(queue.volume);
          }
          
          queue.player.play(resource);

          // Configura o avanço da fila após o término do stream do SoundCloud
          queue.player.once(AudioPlayerStatus.Idle, () => {
            queue.songs.shift();
            playSong(guildId, queue.songs[0]);
          });
          
          return; // Fallback executado com sucesso, interrompe a execução para não pular a música
        }
      } catch (scError) {
        console.error('[ERRO FALLBACK SOUNDCLOUD]', scError.message);
      }
    }

    // Se o fallback também falhar, avança com segurança para a próxima música da fila
    queue.textChannel.send(`⚠️ Falha crítica ao transmitir a faixa **${song.title}** (Transmissão bloqueada regionalmente pelo YouTube).`);
    queue.songs.shift();
    
    setImmediate(() => {
      playSong(guildId, queue.songs[0]);
    });
  }
}

module.exports = { queues, getQueue, createQueue, deleteQueue, playSong };
