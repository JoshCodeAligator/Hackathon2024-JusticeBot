require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow'); // Dialogflow library for intent detection
const firebaseAdmin = require('firebase-admin'); // Firebase admin SDK for Firebase integration

// Initialize Express App
const app = express();

// Middleware to parse JSON and URL-encoded form data (Twilio format)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route to handle GET requests to the root
app.get('/', (req, res) => {
  res.send('Welcome to JustRights API! Your backend is running.');
});

// Initialize Firebase Admin SDK
try {
  const firebaseCredentials = JSON.parse(process.env.FIREBASE_SECRET_KEY); // Parse the JSON string from the env variable
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(firebaseCredentials), // Use parsed JSON object as credentials
  });
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1); // Exit the app if Firebase initialization fails
}

// Twilio credentials
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Twilio client to send SMS
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Dialogflow client setup
const dialogflowClient = new SessionsClient();
const sessionPath = process.env.DIALOGFLOW_PROJECT_ID;

// SMS route to handle incoming messages
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;

  // Ensure 'From' is valid and use it as session ID
  const sessionId = From || 'default-session-id'; // Fallback if From is undefined

  // Send a welcome message to the user when they first text
  if (Body.trim().toLowerCase() === 'start') {
    return res.status(200).send(
      `<Response>
        <Message>Welcome to JustRights, the chatbot here to solve all your problems. What can I help you with today?</Message>
      </Response>`
    );
  }

  // Setup Dialogflow session path
  const session = dialogflowClient.projectAgentSessionPath(process.env.DIALOGFLOW_PROJECT_ID, sessionId);

  // Send the incoming SMS body to Dialogflow to detect intent
  const request = {
    session: session,
    queryInput: {
      text: {
        text: Body,
        languageCode: 'en', // Adjust as needed for other languages
      },
    },
  };

  try {
    // Detect the intent from Dialogflow
    const responses = await dialogflowClient.detectIntent(request);

    // Extract the response from Dialogflow's result
    const dialogflowResponse = responses[0].queryResult.fulfillmentText || 
      "I'm sorry, I couldn't understand that. Can you please clarify?";

    // Send the response from Dialogflow back to the user via Twilio SMS
    return res.status(200).send(
      `<Response>
        <Message>${dialogflowResponse}</Message>
      </Response>`
    );
  } catch (error) {
    console.error('Error interacting with Dialogflow:', error);
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
