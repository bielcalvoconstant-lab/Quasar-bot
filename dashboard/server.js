const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const BotSettings = require('../models/BotSettings');

function startDashboard(client) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Middleware do Webhook do Stripe (requer body bruto)
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error(`[WEBHOOK STRIPE] Erro na assinatura:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const sessionData = event.data.object;
      const userEmail = sessionData.customer_details.email;

      await User.findOneAndUpdate(
        { email: userEmail },
        { isVip: true, stripeCustomerId: sessionData.customer, stripeSubscriptionId: sessionData.subscription },
        { new: true }
      );
      console.log(`[ASSINATURA VIP] Usuário ${userEmail} atualizado para VIP com sucesso.`);
    }

    res.json({ received: true });
  });

  // Middlewares gerais de parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Sessão persistente utilizando MongoDB por até 30 dias
  app.use(session({
    secret: process.env.SESSION_SECRET || 'quasar_key_secret_87364',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      ttl: 30 * 24 * 60 * 60 // 30 Dias
    }),
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, secure: false } // Altere secure para true em ambientes HTTPS de produção
  }));

  // Helper utilitário de criptografia segura baseada em PBKDF2 nativo
  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { salt, hash };
  }

  function verifyPassword(password, salt, hash) {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }

  // Envio de e-mail transacional unificado utilizando a API do Brevo
  async function sendEmail(to, subject, htmlContent) {
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'Quasar Support', email: 'no-reply@quasarbot.xyz' },
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlContent
      }, {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('[ENVIO DE EMAIL] Falha na integração Brevo:', error.response?.data || error.message);
    }
  }

  // --- Rotas de Autenticação Tradicional ---

  app.get('/auth', (req, res) => {
    res.render('verify-email', { error: null, success: null });
  });

  app.post('/auth/register', async (req, res) => {
    const { email, password } = req.body;
    try {
      const userExists = await User.findOne({ email });
      if (userExists) {
        return res.render('verify-email', { error: 'E-mail já cadastrado.', success: null });
      }

      const { salt, hash } = hashPassword(password);
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpires = new Date(Date.now() + 15 * 60 * 1000); // Validade de 15 minutos

      const newUser = new User({
        email,
        passwordHash: hash,
        salt,
        otpCode: otp,
        otpExpires,
        isVerified: false
      });
      await newUser.save();

      await sendEmail(
        email, 
        'Confirmação de Conta - Quasar', 
        `<h2>Seu código de ativação do painel Quasar é: <strong>${otp}</strong></h2>`
      );

      req.session.pendingEmail = email;
      res.redirect('/auth/verify-otp');
    } catch (err) {
      res.render('verify-email', { error: 'Erro no processamento de cadastro.', success: null });
    }
  });

  app.get('/auth/verify-otp', (req, res) => {
    if (!req.session.pendingEmail) return res.redirect('/auth');
    res.render('verify-otp', { email: req.session.pendingEmail, error: null });
  });

  app.post('/auth/verify-otp', async (req, res) => {
    const { otp } = req.body;
    const email = req.session.pendingEmail;
    if (!email) return res.redirect('/auth');

    try {
      const user = await User.findOne({ email });
      if (!user || user.otpCode !== otp || user.otpExpires < Date.now()) {
        return res.render('verify-otp', { email, error: 'Código inválido ou expirado.' });
      }

      user.isVerified = true;
      user.otpCode = undefined;
      user.otpExpires = undefined;
      await user.save();

      req.session.userId = user._id;
      delete req.session.pendingEmail;
      res.redirect('/dashboard');
    } catch (err) {
      res.render('verify-otp', { email, error: 'Erro de validação do OTP.' });
    }
  });

  app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user || !user.isVerified) {
        return res.render('verify-email', { error: 'Usuário inválido ou não verificado.', success: null });
      }

      const isValid = verifyPassword(password, user.salt, user.passwordHash);
      if (!isValid) {
        return res.render('verify-email', { error: 'E-mail ou senha incorretos.', success: null });
      }

      req.session.userId = user._id;

      // Alerta de segurança de login em tempo real enviado ao e-mail cadastrado
      const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      await sendEmail(
        user.email,
        'Novo Login Detectado - Segurança Quasar',
        `<h3>Um novo login foi realizado na sua conta Quasar.</h3>
         <p><strong>Horário:</strong> ${new Date().toLocaleString('pt-BR')}</p>
         <p><strong>IP:</strong> ${userIp}</p>
         <p><strong>Navegador:</strong> ${userAgent}</p>`
      );

      res.redirect('/dashboard');
    } catch (err) {
      res.render('verify-email', { error: 'Houve um erro no processamento do login.', success: null });
    }
  });

  app.post('/auth/forgot', async (req, res) => {
    const { email } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) return res.render('verify-email', { error: 'E-mail não localizado.', success: null });

      const token = crypto.randomBytes(32).toString('hex');
      user.resetToken = token;
      user.resetTokenExpires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hora de expiração
      await user.save();

      // Envia o link de recuperação para o e-mail do usuário
      const resetUrl = `http://${req.headers.host}/auth/reset/${token}`;
      await sendEmail(
        email,
        'Recuperação de Senha - Quasar',
        `<p>Clique no link para resetar sua senha:</p><a href="${resetUrl}">${resetUrl}</a>`
      );

      res.render('verify-email', { error: null, success: 'E-mail de redefinição enviado com sucesso.' });
    } catch (err) {
      res.render('verify-email', { error: 'Erro no envio da recuperação de senha.', success: null });
    }
  });

  // --- Rotas de Autenticação via Discord OAuth2 ---

  app.get('/auth/discord', (req, res) => {
    const redirectUri = encodeURIComponent(`http://${req.headers.host}/auth/discord/callback`);
    const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordUrl);
  });

  app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/auth');

    const redirectUri = `http://${req.headers.host}/auth/discord/callback`;

    try {
      const params = new URLSearchParams();
      params.append('client_id', process.env.DISCORD_CLIENT_ID);
      params.append('client_secret', process.env.DISCORD_CLIENT_SECRET);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', redirectUri);

      const tokenRes = await axios.post('https://discord.com/api/v10/oauth2/token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const accessToken = tokenRes.data.access_token;

      const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const discordUser = userRes.data;

      let user = await User.findOne({ discordId: discordUser.id });
      if (!user) {
        user = new User({
          discordId: discordUser.id,
          username: discordUser.username,
          avatar: discordUser.avatar,
          isVerified: true
        });
      } else {
        user.username = discordUser.username;
        user.avatar = discordUser.avatar;
      }
      user.accessToken = accessToken;
      await user.save();

      req.session.userId = user._id;
      res.redirect('/dashboard');
    } catch (err) {
      console.error(err);
      res.redirect('/auth');
    }
  });

  // --- Rotas de Áreas Administrativas Protegidas ---

  app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/auth');

    try {
      const user = await User.findById(req.session.userId);
      if (!user) return res.redirect('/auth');

      let userGuilds = [];
      if (user.accessToken) {
        try {
          const guildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${user.accessToken}` }
          });
          userGuilds = guildsRes.data.filter(g => (g.permissions & 0x8) === 0x8); // Apenas servidores onde possui permissão Admin
        } catch (oauthErr) {
          console.error('[DISCORD API] Erro ao carregar servidores do usuário');
        }
      }

      res.render('dashboard', { user, guilds: userGuilds });
    } catch (err) {
      res.redirect('/auth');
    }
  });

  // Pagamento Checkout Stripe
  app.post('/stripe/checkout', async (req, res) => {
    if (!req.session.userId) return res.redirect('/auth');

    try {
      const user = await User.findById(req.session.userId);
      if (!user) return res.redirect('/auth');

      const checkoutSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: user.email || undefined,
        line_items: [{
          price: process.env.STRIPE_PRICE_ID, // ID do preço/recorrência cadastrado no Stripe
          quantity: 1,
        }],
        mode: 'subscription',
        success_url: `http://${req.headers.host}/dashboard?status=success`,
        cancel_url: `http://${req.headers.host}/dashboard?status=cancel`,
      });

      res.redirect(303, checkoutSession.url);
    } catch (err) {
      console.error('[STRIPE CHECKOUT]', err);
      res.redirect('/dashboard');
    }
  });

  // Painel de Desenvolvedor Master Global (mafiosodashopping@gmail.com)
  app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/auth');

    const user = await User.findById(req.session.userId);
    if (!user || user.email !== 'mafiosodashopping@gmail.com') {
      return res.status(403).send('Acesso não autorizado pelo desenvolvedor master.');
    }

    const settings = await BotSettings.findOne({ key: 'global_config' }) || {};
    res.render('bot-admin', { user, settings });
  });

  app.post('/admin/update', async (req, res) => {
    if (!req.session.userId) return res.redirect('/auth');

    const user = await User.findById(req.session.userId);
    if (!user || user.email !== 'mafiosodashopping@gmail.com') {
      return res.status(403).send('Acesso Negado.');
    }

    const { status, activityText, activityEmoji } = req.body;

    const updated = await BotSettings.findOneAndUpdate(
      { key: 'global_config' },
      { status, activityText, activityEmoji },
      { new: true, upsert: true }
    );

    // Atualiza a presença do Bot em tempo de execução
    client.user.setPresence({
      status: updated.status,
      activities: [{
        name: updated.activityText,
        type: 4, // Custom Status
        state: `${updated.activityEmoji ? updated.activityEmoji + ' ' : ''}${updated.activityText}`
      }]
    });

    res.redirect('/admin');
  });

  // Rota de Logout
  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/auth');
    });
  });

  app.listen(PORT, () => {
    console.log(`[PAINEL WEB] Servidor rodando na porta ${PORT}`);
  });
}

module.exports = { startDashboard };