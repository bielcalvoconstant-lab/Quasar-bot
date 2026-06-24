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

// Middleware para processar Webhook do Stripe com corpo bruto (obrigatoriamente antes do express.json)
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`[WEBHOOK ERROR] ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Ativação automática do VIP ao detectar o pagamento concluído
  if (event.type === 'checkout.session.completed') {
    const sessionData = event.data.object;
    const clientReferenceId = sessionData.client_reference_id; // ID do usuário do MongoDB salvo no checkout

    if (clientReferenceId) {
      await User.findByIdAndUpdate(clientReferenceId, { isVip: true });
      console.log(`[STRIPE] VIP ativado com sucesso para o usuário ID: ${clientReferenceId}`);
    }
  }

  res.json({ received: true });
});

// Middlewares normais de conversão de dados
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do motor de renderização EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuração do Express-Session integrada ao connect-mongo
app.use(session({
  secret: process.env.SESSION_SECRET || 'chave_secreta_reserva_quasar_123',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    clientPromise: mongoose.connection.asPromise().then(conn => conn.getClient()),
    ttl: 30 * 24 * 60 * 60 // 30 dias de persistência de sessão
  }),
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: false // Altere para true em servidores de produção com SSL/HTTPS configurados
  }
}));

// ==========================================
// 🛠️ FUNÇÕES AUXILIARES DE SEGURANÇA
// ==========================================

// Criptografia PBKDF2 nativa do Node.js
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return verifyHash === hash;
}

// Disparo de e-mail integrado à API v3 do Brevo
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

// Envio de alerta de segurança em tempo real no login
async function sendLoginAlert(userEmail, req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Desconhecido';
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const text = `Um novo login foi detectado na sua conta Quasar.\n\nData/Hora: ${dataHora}\nEndereço de IP: ${ip}\nDispositivo/Navegador: ${userAgent}\n\nSe não foi você, recomendamos redefinir sua senha imediatamente.`;
  await sendBrevoEmail(userEmail, "⚠️ Alerta de Segurança: Novo Login Detectado", text);
}

// ==========================================
// 🛣️ ROTAS DO SISTEMA
// ==========================================

// Rota raiz
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/auth');
});

// Renderização da tela unificada de Login/Cadastro
app.get('/auth', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('verify-email', { error: null, success: null });
});

// Cadastro Local + Envio de OTP via Brevo
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('verify-email', { error: 'Este e-mail já está cadastrado.', success: null });
    }

    const { salt, hash } = hashPassword(password);
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Gera OTP de 6 dígitos

    await User.create({
      email,
      passwordHash: hash,
      salt,
      isVerified: false,
      otp,
      otpExpires: Date.now() + 15 * 60 * 1000 // Expira em 15 minutos
    });

    // Dispara o e-mail via Brevo com o código
    await sendBrevoEmail(
      email,
      "🔑 Seu Código de Verificação Quasar",
      `Seu código de acesso temporário é: ${otp}\nEle expira em 15 minutos.`
    );

    req.session.pendingEmail = email;
    return res.render('verify-otp', { email, error: null });
  } catch (error) {
    console.error(error);
    return res.render('verify-email', { error: 'Erro no servidor durante o cadastro.', success: null });
  }
});

// Validação do código OTP de 6 dígitos
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
    return res.render('verify-email', { error: null, success: 'E-mail verificado! Agora você pode efetuar o login.' });
  } catch (error) {
    console.error(error);
    return res.render('verify-otp', { email, error: 'Erro ao validar o código.' });
  }
});

// Login Local com e-mail e senha (sem OTP) + Envio de Alerta + Ativação VIP automática para o Master
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !user.isVerified) {
      return res.render('verify-email', { error: 'E-mail não verificado ou não existente.', success: null });
    }

    const isValid = verifyPassword(password, user.salt, user.passwordHash);
    if (!isValid) {
      return res.render('verify-email', { error: 'Senha incorreta.', success: null });
    }

    // Regra: se for o e-mail master, garante que ele sempre tenha o VIP ativo no banco de dados
    const isMasterEmail = email.toLowerCase() === (process.env.MASTER_EMAIL || 'mafiosodashopping@gmail.com').toLowerCase();
    if (isMasterEmail && !user.isVip) {
      user.isVip = true;
      await user.save();
    }

    req.session.user = user;

    // Envia alerta de segurança assíncrono para notificar o usuário sobre o login
    sendLoginAlert(user.email, req).catch(err => console.error(err));

    return res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    return res.render('verify-email', { error: 'Erro interno ao realizar o login.', success: null });
  }
});

// CORREÇÃO: Adicionado '%20email' no escopo do link para o Discord retornar seu e-mail real
app.get('/auth/discord', (req, res) => {
  const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20email%20guilds`;
  res.redirect(authorizeUrl);
});

// Callback da integração do Discord (Cadastro e Login automáticos de 1 clique) + Ativação VIP automática para o Master
app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/auth');

  try {
    // Troca o código pelo token de acesso
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
    req.session.accessToken = accessToken; // Armazena na sessão para obter guildas posteriormente

    // Obtém dados do perfil do usuário do Discord
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const discordUser = userResponse.data;
    const email = discordUser.email || `${discordUser.id}@discord.quasar`;

    // Localiza ou cria automaticamente o registro do usuário
    let user = await User.findOne({ email });
    const isMasterEmail = email.toLowerCase() === (process.env.MASTER_EMAIL || 'mafiosodashopping@gmail.com').toLowerCase();

    if (!user) {
      user = await User.create({
        email,
        username: discordUser.username,
        isVerified: true,
        isVip: isMasterEmail ? true : false // Se for o e-mail Master, já cria a conta com VIP ativo
      });
    } else if (isMasterEmail && !user.isVip) {
      // Se a conta já existia mas não tinha VIP, ativa agora
      user.isVip = true;
      await user.save();
    }

    req.session.user = user;
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[ERRO OAUTH2]', error.response ? error.response.data : error.message);
    return res.redirect('/auth');
  }
});

// Logout da sessão
app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/auth');
});

// Renderização do Painel de Servidores do Usuário
app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth');

  let adminGuilds = [];

  // Se o usuário logou via Discord, listamos os servidores administrados por ele
  if (req.session.accessToken) {
    try {
      const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${req.session.accessToken}` }
      });

      // Filtra os servidores onde ele é dono ou possui permissão de Administrador (valor da mask 0x8)
      adminGuilds = guildsResponse.data.filter(g => g.owner || (parseInt(g.permissions) & 0x8) === 0x8);
    } catch (error) {
      console.error('[ERRO BUSCA GUILDAS]', error.message);
    }
  }

  res.render('dashboard', { user: req.session.user, guilds: adminGuilds });
});

// Criação da checkout session do Stripe
app.post('/stripe/checkout', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth');

  try {
    const sessionCheckout = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${req.protocol}://${req.get('host')}/dashboard`,
      cancel_url: `${req.protocol}://${req.get('host')}/dashboard`,
      client_reference_id: req.session.user._id.toString() // ID do usuário associado
    });

    res.redirect(303, sessionCheckout.url);
  } catch (error) {
    console.error('[ERRO STRIPE CHECKOUT]', error.message);
    res.redirect('/dashboard');
  }
});

// ==========================================
// 👑 ROTAS EXCLUSIVAS DO MASTER DEVELOPER
// ==========================================

// Middleware de verificação de permissão do Master
function isMaster(req, res, next) {
  if (req.session.user && req.session.user.email.toLowerCase() === (process.env.MASTER_EMAIL || 'mafiosodashopping@gmail.com').toLowerCase()) {
    return next();
  }
  return res.redirect('/dashboard');
}

// Página exclusiva do Desenvolvedor
app.get('/admin', isMaster, async (req, res) => {
  let settings = await BotSettings.findOne();
  if (!settings) {
    settings = { status: 'online', activityEmoji: '💎', activityText: 'Toque músicas de alta definição' };
  }
  res.render('bot-admin', { settings });
});

// Atualização de Status/Mensagem persistente no banco de dados
app.post('/admin/update', isMaster, async (req, res) => {
  const { status, activityEmoji, activityText } = req.body;

  try {
    await BotSettings.findOneAndUpdate({}, {
      status,
      activityEmoji,
      activityText
    }, { upsert: true, new: true });

    return res.redirect('/admin');
  } catch (error) {
    console.error(error);
    return res.redirect('/dashboard');
  }
});

// Função de inicialização e exportação do servidor web Express
function startDashboard(client) {
  const serverPort = process.env.PORT || 3000;
  app.listen(serverPort, () => {
    console.log(`[PAINEL WEB] Servidor rodando na porta ${serverPort}`);
  });
}

module.exports = { startDashboard };