const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  username: { type: String },
  passwordHash: { type: String }, // Não obrigatório para que o login do Discord funcione sem erros
  salt: { type: String },         // Não obrigatório para que o login do Discord funcione sem erros
  isVerified: { type: Boolean, default: false },
  otp: { type: String },
  otpExpires: { type: Date },
  resetToken: { type: String },
  isVip: { type: Boolean, default: false },
  discordId: { type: String },          // Vinculação automática com ID do Discord
  discordAccessToken: { type: String }   // Para recuperar dados de servidores
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
