require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const { SessionsClient } = require('@google-cloud/dialogflow');

// Initialize Firebase with the Firebase Admin SDK key
const serviceAccount = require('./firebase-admin-key.json'); // Adjust path if necessary
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

// Express setup
const app = express();
app.use(express.json());

// Basic route to handle incoming SMS
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;

  // Firestore setup: Check if the user exists in Firestore, if not, create new entry
  const userRef = db.collection('users').doc(From);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    // If the user does not exist, add them with an initial empty state
    await userRef.set({
      phoneNumber: From,
      previousMessages: [],
    });
  }

  // Check if the user is starting a conversation
  if (Body.toLowerCase() === 'hi') {
    // Send options to the user
    const message = 'Hello! Please choose an option:\n1. Get Info\n2. Help\nReply with the number of your choice.';
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER, // Your Twilio phone number
      to: From,
    });
    res.status(200).send('Options sent!');
    return;
  }

  // If the user selects an option
  if (Body === '1' || Body === '2') {
    let responseMessage = '';

    if (Body === '1') {
      responseMessage = 'You selected "Get Info". Here is the information you requested...';
    } else if (Body === '2') {
      responseMessage = 'You selected "Help". How can I assist you further?';
    }

    // Save the user's selection in Firestore
    await userRef.update({
      previousMessages: admin.firestore.FieldValue.arrayUnion({
        message: Body,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }),
    });

    // Send response to the user
    await twilioClient.messages.create({
      body: responseMessage,
      from: process.env.TWILIO_PHONE_NUMBER, // Your Twilio phone number
      to: From,
    });
    res.status(200).send('Response sent!');
    return;
  }

  // Optional: Use Dialogflow if the input doesn't match the expected options
  const sessionId = From;  // Use phone number as session ID to keep the conversation context
  const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, sessionId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: Body,
        languageCode: 'en',  // You can change this based on user language preference
      },
    },
  };

  try {
    // Detect intent from Dialogflow
    const [response] = await dialogflowClient.detectIntent(request);
    const dialogflowResponse = response.queryResult.fulfillmentText;

    // Save the message to Firestore for context
    await userRef.update({
      previousMessages: admin.firestore.FieldValue.arrayUnion({
        message: Body,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }),
    });

    // Send Dialogflow response back to the user via Twilio
    await twilioClient.messages.create({
      body: dialogflowResponse,
      from: process.env.TWILIO_PHONE_NUMBER, // Your Twilio phone number
      to: From,
    });

    res.status(200).send('Message sent!');
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).send('Error processing message');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
