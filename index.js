const axios = require('axios');
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow'); // Dialogflow client
const { SearchServiceClient } = require('@google-cloud/discoveryengine');
const firebaseAdmin = require('firebase-admin'); // Firebase admin SDK
const discoveryClient = new SearchServiceClient({
  apiEndpoint: 'us-discoveryengine.googleapis.com', // Specify the correct region
});

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

//Helper function to fetch user's location
async function getUserLocation(ip) {
  const API_KEY = process.env.IPINFO_API_KEY;
  try {
    const response = await axios.get(`https://ipinfo.io/${ip}/json?token=${API_KEY}`);
    print(response.data)
    return response.data; // Returns { city, region, country, ... }
  } catch (error) {
    console.error('Error fetching location from IPinfo:', error);
    return null;
  }
}

async function queryVertexAI(query, location) {
  const searchQuery = `${query} in ${location}`;
  const request = {
    servingConfig: 'projects/justicebot-441223/locations/us/dataStores/static-docs-search_1735535987304/servingConfigs/default_config',
    query: searchQuery,
  };

  try {
    const [response] = await discoveryClient.search(request);
    return response.results.map(result => ({
      title: result.document.title,
      snippet: result.document.snippet,
    }));
  } catch (error) {
    console.error('Error querying Vertex AI Search:', error);
    return [];
  }
}

async function queryGoogleCustomSearch(query, location) {
  const API_KEY = process.env.GOOGLE_CSE_API_KEY;
  const CX = process.env.GOOGLE_CSE_ID;

  try {
    const searchQuery = `${query} in ${location}`;
    const response = await axios.get(
      `https://www.googleapis.com/customsearch/v1?q=${searchQuery}&cx=${CX}&key=${API_KEY}`
    );
    return response.data.items.map(item => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));
  } catch (error) {
    console.error('Error querying Google Custom Search API:', error);
    return [];
  }
}

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
  const { Body, From } = req.body;

  // Get the user's IP address
  const userIP = req.ip || '8.8.8.8';

  // Fetch the user's location from IPinfo API
  const userLocation = await getUserLocation(userIP);
  const province = userLocation?.region || 'Unknown';
  console.log("User's Location:", province);

  // Ensure 'From' is valid and use it as session ID
  const sessionId = From || 'default-session-id';
  const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, sessionId);

  // Check if the user is asking for "about bot"
  if (Body.toLowerCase().includes('about bot')) {
    return sendIntroMessage(res);
  }

  try {
    // Check Firestore for previously handled queries
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
      const intent = queryResult.intent?.displayName || "Unknown";
      const intentResponse = queryResult.fulfillmentText || "I'm here to help! Could you clarify what you're looking for?";

      // Query Vertex AI Search for static documents
      const vertexResults = await queryVertexAI(Body, province);

      // Query Google Custom Search API for dynamic resources
      const googleResults = await queryGoogleCustomSearch(Body, province);

      // Combine and format results
      const combinedResults = [
        ...vertexResults,
        ...googleResults,
      ].slice(0, 3);

      const responseText = combinedResults.length > 0
        ? combinedResults.map(result => `${result.title}: ${result.snippet}`).join('\n\n')
        : intentResponse;

      // Save response to Firestore
      await responsesCollection.add({
        phoneNumber: From,
        userInput: Body,
        intent: intent,
        response: responseText,
      });

      // Send response to the user
      return res.status(200).send(
        `<Response>
          <Message>${responseText}</Message>
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
