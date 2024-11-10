require('dotenv').config();
const express = require('express');
const smsRoutes = require('./routes/smsRoutes');

const app = express();
app.use(express.json());

app.use('/', smsRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
