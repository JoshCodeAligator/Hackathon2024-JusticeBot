require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const dialogflow = require('@google-cloud/dialogflow');

// Initialize Firebase with the Firebase Admin SDK key
const serviceAccount = require('./firebase-admin-key.json'); // Adjust path if necessary
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Initialize Firestore
const db = admin.firestore();

// Initialize Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Initialize Dialogflow using the existing Firebase credentials
const sessionClient = new dialogflow.SessionsClient(); // Uses Firebase credentials

//Helper to detect initent
async function detectIntent(projectId, sessionId, query, languageCode = 'en') {
  const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: query,
        languageCode,
      },
    },
  };

  const responses = await sessionClient.detectIntent(request);
  return responses[0].queryResult;
}

// Express setup
const app = express();
app.use(express.json());

// Basic route to handle incoming SMS
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;

  // Example response message
  const responseMessage = `Hello, you sent: ${Body}`;

  // Log the SMS to Firestore
  try {
    await db.collection('messages').add({
      text: Body,
      sender: From,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Message logged to Firestore');
  } catch (error) {
    console.error('Error logging message to Firestore:', error);
  }

  // Send SMS response
  try {
    await twilioClient.messages.create({
      body: responseMessage,
      from: +13205230818, // Your Twilio phone number
      to: From,
    });
    res.status(200).send('Message sent!');
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send('Error sending message');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
