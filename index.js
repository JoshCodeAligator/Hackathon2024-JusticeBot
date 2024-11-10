require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const twilio = require('twilio');

// Initialize Express App
const app = express();

// Middleware to parse JSON and URL-encoded form data (Twilio format)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route to handle GET requests to the root
app.get('/', (req, res) => {
  res.send('Welcome to JustRights API! Your backend is running.');
});

// Twilio credentials
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Twilio client to send SMS
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// SMS route to handle incoming messages
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body; // Get the body of the SMS and the sender's number (From)

  // Send a welcome message to the user when they first text "start"
  if (Body.trim().toLowerCase() === 'start') {
    return res.status(200).send(
      `<Response>
        <Message>Welcome to JustRights! How can I help you today?</Message>
      </Response>`
    );
  }

  // Default response for any other input
  return res.status(200).send(
    `<Response>
      <Message>Thank you for your message. We received: "${Body}"</Message>
    </Response>`
  );
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
