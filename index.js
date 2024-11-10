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
    <h1>Welcome to JustBot API!</h1>
    <p>We’re here to help you understand your rights and protections, especially under Alberta’s Human Rights framework. Just send a message, and our chatbot will provide the information you need or direct you to helpful resources. Your privacy is important to us, and we track common questions to respond faster in the future.</p>
    <p>How can I assist you today?</p>

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
      <Message>Welcome to JustBot! If you're feeling uncertain or need quick answers, we're here to help. Just let us know what you're facing, and we’ll provide clear, real-time information about your rights based on your location.</Message>
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
  if (Body.toLowerCase().includes('about bot')) {
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
      const queryResult = responses[0].queryResult;
      const intentResponse = queryResult.fulfillmentText || "I'm here to help! Could you clarify what you're looking for?";

      // Only store if an intent is retrieved
      if (queryResult.intent) {
        await responsesCollection.add({
          phoneNumber: From,
          userInput: Body,
          intent: queryResult.intent.displayName,
          response: intentResponse
        });
      }

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
