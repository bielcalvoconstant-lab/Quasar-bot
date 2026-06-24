const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const User = require('../models/User');
const BotSettings = require('../models/BotSettings');
const GuildConfig = require('../models/GuildConfig');

const app = express();

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
  store: MongoStore.create({
    clientPromise: mongoose.connection.asPromise().then(conn => conn.getClient()),
    ttl: 30 * 24 * 60 * 60
  }),
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: false
  }
}));

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
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: "Quasar Bot", email: process.env.BREVO_SENDER_EMAIL },
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

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  return res.redirect('/auth');
});

app.get('/auth', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('verify-email', { error: null, success: null });
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
    sendLoginAlert(user.email, req).catch(err => console.error(err));
    return res.redirect('/dashboard');
  } catch (error) {
    return res.render('verify-email', { error: 'Erro interno.', success: null });
  }
});

// URL OAuth2 com escopo de email obrigatório
app.get('/auth/discord', (req, res) => {
  const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20email%20guilds`;
  res.redirect(authorizeUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/auth');

  try {
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenResponse.data.access_token;
    req.session.accessToken = accessToken;

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const discordUser = userResponse.data;
    const email = discordUser.email || `${discordUser.id}@discord.quasar`;

    // Se o usuário já estiver logado via E-mail, este callback vincula a conta do Discord dele!
    if (req.session.user) {
      const user = await User.findById(req.session.user._id);
      if (user) {
        user.discordId = discordUser.id;
        user.discordAccessToken = accessToken;
        if (!user.username) user.username = discordUser.username;
        await user.save();
        req.session.user = user;
      }
      return res.redirect('/dashboard');
    }

    // Login Direto / Registro automático via Discord
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
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[ERRO OAUTH2]', error.response ? error.response.data : error.message);
    return res.redirect('/auth');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/auth');
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth');

  let adminGuilds = [];
  let token = req.session.accessToken;

  // Busca o token do banco se tiver feito login por e-mail e possuir o Discord vinculado
  if (!token) {
    const userDb = await User.findById(req.session.user._id);
    if (userDb && userDb.discordAccessToken) {
      token = userDb.discordAccessToken;
    }
  }

  if (token) {
    try {
      const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token}` }
      });
      adminGuilds = guildsResponse.data.filter(g => g.owner || (parseInt(g.permissions) & 0x8) === 0x8);
    } catch (error) {
      console.error('[ERRO GUILDAS]', error.message);
    }
  }

  res.render('dashboard', { 
    user: req.session.user, 
    guilds: adminGuilds, 
    hasDiscordLinked: !!token 
  });
});

app.post('/stripe/checkout', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth');

  try {
    const sessionCheckout = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: 'subscription',
      success_url: `${req.protocol}://${req.get('host')}/dashboard`,
      cancel_url: `${req.protocol}://${req.get('host')}/dashboard`,
      client_reference_id: req.session.user._id.toString()
    });

    res.redirect(303, sessionCheckout.url);
  } catch (error) {
    res.redirect('/dashboard');
  }
});

function isMaster(req, res, next) {
  if (req.session.user && req.session.user.email === process.env.MASTER_EMAIL) {
    return next();
  }
  return res.redirect('/dashboard');
}

app.get('/admin', isMaster, async (req, res) => {
  let settings = await BotSettings.findOne();
  if (!settings) {
    settings = { status: 'online', activityEmoji: '💎', activityText: 'Toque músicas de alta definição' };
  }
  res.render('bot-admin', { settings });
});

app.post('/admin/update', isMaster, async (req, res) => {
  const { status, activityEmoji, activityText } = req.body;
  try {
    await BotSettings.findOneAndUpdate({}, { status, activityEmoji, activityText }, { upsert: true, new: true });
    return res.redirect('/admin');
  } catch (error) {
    return res.redirect('/dashboard');
  }
});

function startDashboard(client) {
  const serverPort = process.env.PORT || 3000;
  app.listen(serverPort, () => {
    console.log(`[PAINEL WEB] Servidor rodando na porta ${serverPort}`);
  });
}

module.exports = { startDashboard };