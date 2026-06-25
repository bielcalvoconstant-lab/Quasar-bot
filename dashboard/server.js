const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const play = require('play-dl');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const User = require('../models/User');
const BotSettings = require('../models/BotSettings');
const GuildConfig = require('../models/GuildConfig');

const { queues, deleteQueue, playSong } = require('../utils/musicManager');

const app = express();

app.set('trust proxy', 1); 

let discordClient = null;

const getRedirectUri = (req) => {
  const rawBaseUrl = process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
  const baseUrl = rawBaseUrl.replace(/\/$/, '');
  return `${baseUrl}/auth/discord/callback`;
};

function formatDuration(duration) {
  if (typeof duration === 'string') return duration;
  if (!duration) return '0:00';
  
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

app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`[WEBHOOK ERROR] ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const sessionData = event.data.object;
    const clientReferenceId = sessionData.client_reference_id;

    if (clientReferenceId) {
      await User.findByIdAndUpdate(clientReferenceId, { isVip: true });
      console.log(`[STRIPE] VIP ativado com sucesso para o usuário ID: ${clientReferenceId}`);
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'chave_secreta_reserva_quasar_123',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  store: MongoStore.create({
    clientPromise: mongoose.connection.asPromise().then(conn => conn.getClient()),
    ttl: 30 * 24 * 60 * 60
  }),
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: false, 
    httpOnly: true
  }
}));

// ==========================================
// 🛠️ FUNÇÕES AUXILIARES DE SEGURANÇA
// ==========================================

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return verifyHash === hash;
}

async function sendBrevoEmail(toEmail, subject, textContent) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL;

  if (!senderEmail) {
    console.warn('[AVISO BREVO] O envio de e-mail foi abortado porque a variável BREVO_SENDER_EMAIL não está configurada no Railway.');
    return;
  }

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: "Quasar Bot", email: senderEmail },
      to: [{ email: toEmail }],
      subject: subject,
      textContent: textContent
    }, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('[ERRO BREVO]', err.response ? err.response.data : err.message);
  }
}

async function sendLoginAlert(userEmail, req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Desconhecido';
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const text = `Um novo login foi detectado na sua conta Quasar.\n\nData/Hora: ${dataHora}\nEndereço de IP: ${ip}\nDispositivo/Navegador: ${userAgent}`;
  await sendBrevoEmail(userEmail, "⚠️ Alerta de Segurança: Novo Login", text);
}

// ROTA RAIZ
app.get('/', (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (req.session.user) {
    return res.redirect(`${baseUrl}/dashboard`);
  }
  return res.redirect(`${baseUrl}/auth`);
});

app.get('/auth', (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (req.session.user) return res.redirect(`${baseUrl}/dashboard`);

  const queryError = req.query.error || null;
  res.render('verify-email', { error: queryError, success: null });
});

app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('verify-email', { error: 'Este e-mail já está cadastrado.', success: null });
    }

    const { salt, hash } = hashPassword(password);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await User.create({
      email,
      passwordHash: hash,
      salt,
      isVerified: false,
      otp,
      otpExpires: Date.now() + 15 * 60 * 1000
    });

    await sendBrevoEmail(email, "🔑 Código Quasar", `Seu código é: ${otp}`);
    req.session.pendingEmail = email;
    return res.render('verify-otp', { email, error: null });
  } catch (error) {
    console.error(error);
    return res.render('verify-email', { error: 'Erro no servidor.', success: null });
  }
});

app.post('/auth/verify-otp', async (req, res) => {
  const { otp } = req.body;
  const email = req.session.pendingEmail;
  if (!email) return res.redirect('/auth');

  try {
    const user = await User.findOne({ email });
    if (!user || user.otp !== otp || user.otpExpires < Date.now()) {
      return res.render('verify-otp', { email, error: 'Código inválido ou expirado.' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    req.session.pendingEmail = null;
    return res.render('verify-email', { error: null, success: 'E-mail verificado! Acesse com seu login.' });
  } catch (error) {
    return res.render('verify-otp', { email, error: 'Erro de validação.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  try {
    const user = await User.findOne({ email });
    if (!user || !user.isVerified) {
      return res.render('verify-email', { error: 'E-mail não verificado ou não cadastrado.', success: null });
    }

    const isValid = verifyPassword(password, user.salt, user.passwordHash);
    if (!isValid) {
      return res.render('verify-email', { error: 'Senha incorreta.', success: null });
    }

    req.session.user = user;
    
    req.session.save((err) => {
      if (err) console.error('[ERRO SALVAR SESSÃO LOGOUT/LOGIN]', err);
      sendLoginAlert(user.email, req).catch(err => console.error(err));
      return res.redirect(`${baseUrl}/dashboard`);
    });
  } catch (error) {
    return res.render('verify-email', { error: 'Erro interno.', success: null });
  }
});

app.get('/auth/discord', (req, res) => {
  const redirectUri = getRedirectUri(req);
  console.log(`[DISCORD OAUTH] Link de redirecionamento gerado: ${redirectUri}`);
  const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email%20guilds`;
  res.redirect(authorizeUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  
  if (!code) return res.redirect(`${baseUrl}/auth?error=${encodeURIComponent('Código de autorização ausente.')}`);

  try {
    const redirectUri = getRedirectUri(req);
    
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(), 
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'QuasarBot (https://quasar-bot.up.railway.app, 1.0.0)' 
        }
      }
    );

    const accessToken = tokenResponse.data.access_token;
    req.session.accessToken = accessToken;

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { 
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'QuasarBot (https://quasar-bot.up.railway.app, 1.0.0)'
      }
    });

    const discordUser = userResponse.data;
    const email = discordUser.email || `${discordUser.id}@discord.quasar`;

    if (req.session.user) {
      const user = await User.findById(req.session.user._id);
      if (user) {
        user.discordId = discordUser.id;
        user.discordAccessToken = accessToken;
        if (!user.username) user.username = discordUser.username;
        await user.save();
        req.session.user = user;
      }
      
      return req.session.save((err) => {
        if (err) console.error(err);
        return res.redirect(`${baseUrl}/dashboard`);
      });
    }

    let user = await User.findOne({ $or: [{ discordId: discordUser.id }, { email }] });
    if (!user) {
      user = await User.create({
        email,
        username: discordUser.username,
        isVerified: true,
        isVip: false,
        discordId: discordUser.id,
        discordAccessToken: accessToken
      });
    } else {
      user.discordId = discordUser.id;
      user.discordAccessToken = accessToken;
      await user.save();
    }

    req.session.user = user;
    
    req.session.save((err) => {
      if (err) console.error(err);
      return res.redirect(`${baseUrl}/dashboard`);
    });

  } catch (error) {
    console.error('[ERRO OAUTH2 DETALHADO]', error.response ? error.response.data : error.message);
    const detailedMsg = error.response?.data?.error_description || error.response?.data?.error || error.message || 'Erro inesperado na autenticação.';
    return res.redirect(`${baseUrl}/auth?error=${encodeURIComponent(`Erro de Autenticação: ${detailedMsg}`)}`);
  }
});

app.get('/auth/logout', (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  req.session.destroy(() => {
    res.redirect(`${baseUrl}/auth`);
  });
});

app.get('/dashboard', async (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (!req.session.user) return res.redirect(`${baseUrl}/auth`);

  let adminGuilds = [];
  let token = req.session.accessToken;

  if (!token) {
    const userDb = await User.findById(req.session.user._id);
    if (userDb && userDb.discordAccessToken) {
      token = userDb.discordAccessToken;
    }
  }

  if (token) {
    try {
      const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
        headers: { 
          Authorization: `Bearer ${token}`,
          'User-Agent': 'QuasarBot (https://quasar-bot.up.railway.app, 1.0.0)'
        }
      });
      adminGuilds = guildsResponse.data.filter(g => g.owner || (parseInt(g.permissions) & 0x8) === 0x8);
    } catch (error) {
      console.error('[ERRO GUILDAS]', error.message);
    }
  }

  res.render('dashboard', { 
    user: req.session.user, 
    guilds: adminGuilds, 
    hasDiscordLinked: !!token,
    dashboardUrl: baseUrl
  });
});

// ==========================================
// 🛠️ ROTAS DO PAINEL ADMINISTRATIVO DO SERVIDOR
// ==========================================

app.get('/dashboard/guild/:guildId', async (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (!req.session.user) return res.redirect(`${baseUrl}/auth`);

  const { guildId } = req.params;

  if (!discordClient) {
    return res.redirect(`${baseUrl}/dashboard`);
  }

  try {
    const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return res.redirect(`${baseUrl}/dashboard`);
    }

    let config = await GuildConfig.findOne({ guildId });
    if (!config) {
      config = await GuildConfig.create({ guildId });
    }

    const channels = guild.channels.cache
      .filter(c => c.type === 0) 
      .map(c => ({ id: c.id, name: c.name }));

    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => ({ id: r.id, name: r.name }));

    const serverQueue = queues.get(guildId) || null;

    res.render('guild', {
      guild,
      config,
      channels,
      roles,
      user: req.session.user,
      success: req.query.success || null,
      serverQueue 
    });

  } catch (err) {
    console.error(err);
    res.redirect(`${baseUrl}/dashboard`);
  }
});

app.post('/dashboard/guild/:guildId/update', async (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (!req.session.user) return res.redirect(`${baseUrl}/auth`);

  const { guildId } = req.params;
  const { logChannelId, staffRoleId, punishmentLimit } = req.body;

  try {
    await GuildConfig.findOneAndUpdate(
      { guildId },
      { logChannelId, staffRoleId, punishmentLimit: parseInt(punishmentLimit) || 5 },
      { upsert: true, new: true }
    );

    return res.redirect(`${baseUrl}/dashboard/guild/${guildId}?success=Configurações+atualizadas+com+sucesso!`);
  } catch (err) {
    console.error(err);
    return res.redirect(`${baseUrl}/dashboard/guild/${guildId}`);
  }
});

// ==========================================
// 📻 CONTROLADORES DO PLAYER WEB DE MÚSICA (SOUNDCLOUD ONLY)
// ==========================================

app.post('/dashboard/guild/:guildId/music/volume', async (req, res) => {
  if (!req.session.user) return res.sendStatus(401);
  const { guildId } = req.params;
  const { volume } = req.body; 

  const serverQueue = queues.get(guildId);
  if (serverQueue) {
    const parsedVolume = parseFloat(volume) / 100;
    serverQueue.volume = parsedVolume;
    
    if (serverQueue.player && serverQueue.player.state.resource) {
      serverQueue.player.state.resource.volume?.setVolume(parsedVolume);
    }
  }
  res.sendStatus(200);
});

app.post('/dashboard/guild/:guildId/music/control', async (req, res) => {
  if (!req.session.user) return res.sendStatus(401);
  const { guildId } = req.params;
  const { action } = req.body;

  const serverQueue = queues.get(guildId);
  if (serverQueue) {
    switch (action) {
      case 'pause':
        serverQueue.player.pause();
        serverQueue.playing = false;
        break;
      case 'resume':
        serverQueue.player.unpause();
        serverQueue.playing = true;
        break;
      case 'skip':
        serverQueue.player.stop();
        break;
      case 'stop':
        deleteQueue(guildId);
        break;
      case 'toggle247':
        serverQueue.is247 = !serverQueue.is247;
        break;
    }
  }
  res.sendStatus(200);
});

// Adiciona músicas usando o motor do SoundCloud como prioritário e exclusivo
app.post('/dashboard/guild/:guildId/music/add', async (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (!req.session.user) return res.redirect(`${baseUrl}/auth`);

  const { guildId } = req.params;
  const { query } = req.body;

  const serverQueue = queues.get(guildId);
  if (!serverQueue) {
    return res.redirect(`${baseUrl}/dashboard/guild/${guildId}?success=O+bot+precisa+estar+conectado+em+um+canal+de+voz+pelo+Discord+para+que+você+possa+adicionar+músicas+pelo+site.`);
  }

  try {
    let scInfo = null;
    let finalUrl = null;
    const isSpotify = play.sp_validate(query);
    
    // CORREÇÃO: Validação nativa de string para evitar erros de função inexistente sc_validate
    const isSoundcloud = query.includes('soundcloud.com');

    if (isSpotify && isSpotify === 'track') {
      const spotifyData = await play.spotify(query);
      const searchQuery = `${spotifyData.name} - ${spotifyData.artists.map(a => a.name).join(' ')}`;
      const searchResults = await play.search(searchQuery, { source: { soundcloud: 'tracks' }, limit: 1 });
      if (searchResults && searchResults.length > 0) {
        finalUrl = searchResults[0].url;
        scInfo = searchResults[0];
      }
    } else if (isSoundcloud) {
      finalUrl = query;
      scInfo = await play.soundcloud(query);
    } else {
      const searchResults = await play.search(query, { source: { soundcloud: 'tracks' }, limit: 1 });
      if (searchResults && searchResults.length > 0) {
        finalUrl = searchResults[0].url;
        scInfo = searchResults[0];
      }
    }

    if (scInfo && finalUrl) {
      const song = {
        title: scInfo.name || scInfo.title,
        url: finalUrl,
        duration: formatDuration(scInfo.duration),
        thumbnail: scInfo.thumbnail || ''
      };

      serverQueue.songs.push(song);
      
      if (serverQueue.songs.length === 1) {
        await playSong(guildId, song);
      }

      return res.redirect(`${baseUrl}/dashboard/guild/${guildId}?success=Música+adicionada+com+sucesso+pelo+site!`);
    } else {
      return res.redirect(`${baseUrl}/dashboard/guild/${guildId}?success=Não+foi+possível+encontrar+esta+faixa+no+SoundCloud.`);
    }

  } catch (err) {
    console.error('[ERRO ADD WEB]', err);
    return res.redirect(`${baseUrl}/dashboard/guild/${guildId}?success=Erro+ao+processar+a+música+solicitada.`);
  }
});

// Stripe Checkout
app.post('/stripe/checkout', async (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (!req.session.user) return res.redirect(`${baseUrl}/auth`);

  try {
    const sessionCheckout = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/dashboard`,
      cancel_url: `${baseUrl}/dashboard`,
      client_reference_id: req.session.user._id.toString()
    });

    res.redirect(303, sessionCheckout.url);
  } catch (error) {
    console.error('[ERRO CHECKOUT]', error.message);
    res.redirect(`${baseUrl}/dashboard`);
  }
});

// Middleware Master
function isMaster(req, res, next) {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  if (req.session.user && (req.session.user.email === 'mafiosodashopping@gmail.com' || req.session.user.email === process.env.MASTER_EMAIL)) {
    return next();
  }
  return res.redirect(`${baseUrl}/dashboard`);
}

app.get('/admin', isMaster, async (req, res) => {
  let settings = await BotSettings.findOne();
  if (!settings) {
    settings = { status: 'online', activityEmoji: '💎', activityText: 'Toque músicas de alta definição' };
  }
  res.render('bot-admin', { settings });
});

app.post('/admin/update', isMaster, async (req, res) => {
  const baseUrl = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const { status, activityEmoji, activityText } = req.body;
  try {
    await BotSettings.findOneAndUpdate({}, { status, activityEmoji, activityText }, { upsert: true, new: true });
    
    if (discordClient) {
      discordClient.user.setPresence({
        status: status,
        activities: [{
          name: 'custom',
          type: require('discord.js').ActivityType.Custom,
          state: `${activityEmoji} ${activityText}`
        }]
      });
      console.log('[PRESENÇA] Status e atividade atualizados via painel de administração em tempo real.');
    }

    return res.redirect(`${baseUrl}/admin`);
  } catch (error) {
    return res.redirect(`${baseUrl}/dashboard`);
  }
});

function startDashboard(client) {
  discordClient = client; 
  const serverPort = process.env.PORT || 3000;
  app.listen(serverPort, () => {
    console.log(`[PAINEL WEB] Servidor rodando na porta ${serverPort}`);
  });
}

module.exports = { startDashboard };