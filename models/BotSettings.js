const mongoose = require('mongoose');

const botSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global_config', unique: true },
  status: { type: String, default: 'online' }, // online, idle, dnd
  activityType: { type: String, default: 'Custom' }, // Playing, Listening, Custom
  activityText: { type: String, default: 'Música de alta fidelidade para o seu servidor' },
  activityEmoji: { type: String, default: '💎' }
});

module.exports = mongoose.model('BotSettings', botSettingsSchema);
