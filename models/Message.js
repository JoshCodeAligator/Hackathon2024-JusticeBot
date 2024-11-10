// models/Message.js
const mongoose = require('../config/mongo'); // Import the mongoose instance

const messageSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;
