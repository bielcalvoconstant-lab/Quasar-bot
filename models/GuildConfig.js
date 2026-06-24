const mongoose = require('mongoose');

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  logChannelId: { type: String, default: null }, // ID do canal onde os logs de ban/kick serão enviados
  staffRoleId: { type: String, default: null },  // ID do cargo permitido a usar moderação
  punishmentLimit: { type: Number, default: 5 }  // Limite preventivo configurado
}, { timestamps: true });

module.exports = mongoose.model('GuildConfig', guildConfigSchema);
