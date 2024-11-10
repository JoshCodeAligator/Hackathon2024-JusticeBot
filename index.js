// index.js
require('dotenv').config();
const express = require('express');
require('./config/mongo'); // Initialize MongoDB connection

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const smsRoutes = require('./routes/smsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

app.use('/sms', smsRoutes);
app.use('/webhook', webhookRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
