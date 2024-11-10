require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow'); // Dialogflow client
const firebaseAdmin = require('firebase-admin'); // Firebase admin SDK
const fs = require('fs');
const path = require('path');

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

// Initialize Twilio client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Firebase Secret (Base64 encoded in environment variable)
const base64FirebaseSecret = process.env.DIALOGFLOW_FIREBASE_SECRET;
const firebaseSecret = Buffer.from(base64FirebaseSecret, 'base64').toString('utf8');
const firebaseSecretPath = path.join(__dirname, 'firebase_secret.json');

// Write the decoded secret to a temporary file
fs.writeFileSync(firebaseSecretPath, firebaseSecret);

// Initialize Firebase Admin SDK
try {
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(firebaseSecretPath), // Use the secret file
  });
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1); // Exit the app if Firebase initialization fails
}

// Initialize Dialogflow client
const dialogflowClient = new SessionsClient();
const projectId = process.env.DIALOGFLOW_PROJECT_ID; // Set the Dialogflow project ID in your .env

// SMS route to handle incoming messages
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body; // Get the body of the SMS and the sender's number (From)

  // Ensure 'From' is valid and use it as session ID
  const sessionId = From || 'default-session-id'; // Fallback if From is undefined
  const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, sessionId); // Dialogflow session path

  // Create a request for Dialogflow to detect intent
  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: Body,
        languageCode: 'en', // Adjust as needed for other languages
      },
    },
  };

  try {
    // Detect intent from Dialogflow
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
