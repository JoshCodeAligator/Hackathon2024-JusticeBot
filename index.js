const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow'); // Dialogflow client
const firebaseAdmin = require('firebase-admin'); // Firebase admin SDK

// Initialize Express App
const app = express();

// Middleware to parse JSON and URL-encoded form data (Twilio format)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route to handle GET requests to the root
app.get('/', (req, res) => {
  res.send(`
    <h1>Welcome to JustRights API!</h1>
    <p>This service is here to support you with clear information about your rights and protections. 
    We provide instant assistance for users seeking justice and rights information, especially within the Alberta Human Rights framework. 
    Simply send a message, and our chatbot will help you understand your rights or direct you to resources for further action. 
    Your requests are securely processed, and frequent questions are stored to ensure prompt responses in the future.</p>
  `);
});

// Twilio credentials
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Ensure required environment variables are set
if (!TWILIO_PHONE_NUMBER || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error('Twilio credentials are missing from environment variables.');
  process.exit(1);
}

// Initialize Twilio client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Firebase Admin SDK initialization
try {
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.applicationDefault(),
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1);
}

// Firestore setup
const db = firebaseAdmin.firestore();
const responsesCollection = db.collection('responses');

// Initialize Dialogflow client
const dialogflowClient = new SessionsClient();
const projectId = process.env.DIALOGFLOW_PROJECT_ID;

if (!projectId) {
  console.error('DIALOGFLOW_PROJECT_ID is not set.');
  process.exit(1);
}

// Send Introductory Message
const sendIntroMessage = (res) => {
  return res.status(200).send(
    `<Response>
      <Message>Welcome to JustRights! This service provides instant guidance on your rights and protections, especially within Alberta’s Human Rights framework. Just text us your question, and we'll help you with relevant info.</Message>
    </Response>`
  );
};

// SMS route to handle incoming messages
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body; // Get the SMS text and sender's phone number

  // Ensure 'From' is valid and use it as session ID
  const sessionId = From || 'default-session-id';
  const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, sessionId);

  // Check if the user is asking for "about bot" or "reset"
  if (Body.toLowerCase().includes('about bot') || Body.toLowerCase().includes('reset')) {
    return sendIntroMessage(res); // Send the intro message again
  }

  // Check Firestore to see if we have previously handled this query
  try {
    const existingQuery = await responsesCollection
      .where('phoneNumber', '==', From)
      .where('userInput', '==', Body)
      .get();

    if (!existingQuery.empty) {
      const existingData = existingQuery.docs[0].data();
      const savedResponse = existingData.response;
      return res.status(200).send(
        `<Response>
          <Message>Welcome back! Here’s the info we previously shared: ${savedResponse}</Message>
        </Response>`
      );
    } else {
      // Dialogflow request for a new query
      const request = {
        session: sessionPath,
        queryInput: {
          text: {
            text: Body,
            languageCode: 'en',
          },
        },
      };

      const responses = await dialogflowClient.detectIntent(request);
      const intentResponse = responses[0].queryResult.fulfillmentText ||
        "I'm here to help! Could you clarify what you're looking for?";

      // Save the essential information to Firestore
      await responsesCollection.add({
        phoneNumber: From,
        userInput: Body,
        intent: responses[0].queryResult.intent.displayName,
        response: intentResponse
      });

      // Send response from Dialogflow to the user
      return res.status(200).send(
        `<Response>
          <Message>${intentResponse}</Message>
        </Response>`
      );
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).send(
      `<Response>
        <Message>There was an error processing your request. Please try again later.</Message>
      </Response>`
    );
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
