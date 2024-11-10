require('dotenv').config();
const express = require('express');
const smsRoutes = require('./routes/smsRoutes'); // Import smsRoutes

// Initialize Express App
const app = express();
app.use(express.json()); // Middleware to parse JSON requests
app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded form data (Twilio format)

// Routes
app.use('/sms', smsRoutes); // Routes for handling SMS requests

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
