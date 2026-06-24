const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  salt: { type: String },
  isVerified: { type: Boolean, default: false },
  
  // Fluxo de verificação e segurança OTP
  otpCode: { type: String },
  otpExpires: { type: Date },
  resetToken: { type: String },
  resetTokenExpires: { type: Date },

  // Integração com o Discord (OAuth2)
  discordId: { type: String, unique: true, sparse: true },
  username: { type: String },
  avatar: { type: String },
  accessToken: { type: String },

  // Controle do VIP (Stripe)
  isVip: { type: Boolean, default: false },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
