require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const { SessionsClient } = require('@google-cloud/dialogflow');

// Initialize Express App
const app = express();
app.use(express.json());

// Initialize Firebase with the Firebase Admin SDK key
const serviceAccount = require('./firebase-admin-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Initialize Firestore
const db = admin.firestore();

// Initialize Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Initialize Dialogflow Client
const dialogflowClient = new SessionsClient();
const projectId = process.env.DIALOGFLOW_PROJECT_ID;

// Helper function to detect intent with Dialogflow
async function detectIntent(projectId, sessionId, query, languageCode = 'en') {
  const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, sessionId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: query,
        languageCode,
      },
    },
  };

  const responses = await dialogflowClient.detectIntent(request);
  return responses[0].queryResult;
}

// Route to get messages by phone number
app.get('/api/messages', async (req, res) => {
  const phone = req.query.phone;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const messagesRef = db.collection('messages');
    const snapshot = await messagesRef.where('sender', '==', phone).orderBy('timestamp', 'desc').get();

    if (snapshot.empty) {
      return res.json([]);
    }

    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Route to handle incoming SMS
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;

  // Log the incoming SMS to Firestore and check if the user exists
  const userRef = db.collection('users').doc(From);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    await userRef.set({
      phoneNumber: From,
      previousMessages: [],
    });
  }

  // Check for specific options
  if (Body.toLowerCase() === 'hi') {
    const optionsMessage = 'Hello! Please choose an option:\n1. Get Info\n2. Help\nReply with the number of your choice.';
    await twilioClient.messages.create({
      body: optionsMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: From,
    });
    res.status(200).send('Options sent!');
    return;
  }

  if (Body === '1' || Body === '2') {
    const responseMessage = Body === '1'
      ? 'You selected "Get Info". Here is the information you requested...'
      : 'You selected "Help". How can I assist you further?';

    await userRef.update({
      previousMessages: admin.firestore.FieldValue.arrayUnion({
        message: Body,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }),
    });

    await twilioClient.messages.create({
      body: responseMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: From,
    });
    res.status(200).send('Response sent!');
    return;
  }

  // Handle non-option responses with Dialogflow
  try {
    const dialogflowResponse = await detectIntent(projectId, From, Body);
    const responseMessage = dialogflowResponse.fulfillmentText || "I'm not sure how to respond to that.";

    await userRef.update({
      previousMessages: admin.firestore.FieldValue.arrayUnion({
        message: Body,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }),
    });

    await twilioClient.messages.create({
      body: responseMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: From,
    });

    res.status(200).send('Message sent!');
  } catch (error) {
    console.error('Error processing message with Dialogflow:', error);
    res.status(500).send('Error processing message');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
