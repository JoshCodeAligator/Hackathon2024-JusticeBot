require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const dialogflow = require('@google-cloud/dialogflow');

// Initialize Express App
const app = express();
app.use(express.json());

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

// Helper function to detect intent with Dialogflow
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
  const projectId = 'your-dialogflow-project-id'; // Replace with your Dialogflow project ID

  // Log the incoming SMS to Firestore
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

  // Send the message to Dialogflow and get the response
  let responseMessage;
  try {
    const dialogflowResponse = await detectIntent(projectId, From, Body);
    responseMessage = dialogflowResponse.fulfillmentText || "I'm not sure how to respond to that.";
  } catch (error) {
    console.error('Error processing message with Dialogflow:', error);
    responseMessage = 'Sorry, something went wrong while processing your message.';
  }

  // Send the Dialogflow response back to the user via Twilio
  try {
    await twilioClient.messages.create({
      body: responseMessage,
      from: process.env.TWILIO_PHONE_NUMBER, // Ensure this is set in your .env file
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
