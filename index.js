const axios = require('axios');
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { SearchServiceClient } = require('@google-cloud/discoveryengine');
const firebaseAdmin = require('firebase-admin');

// Initialize Discovery Engine client
const discoveryClient = new SearchServiceClient({
  apiEndpoint: 'us-discoveryengine.googleapis.com',
});

// Initialize Express App
const app = express();

// Middleware to parse JSON and URL-encoded form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to fetch user's location from IP
async function getUserLocation(ip) {
  const API_KEY = process.env.IPINFO_API_KEY;
  try {
    const response = await axios.get(`https://ipinfo.io/${ip}/json?token=${API_KEY}`);
    return response.data; // Returns { city, region, country, ... }
  } catch (error) {
    console.error('Error fetching location from IPinfo:', error);
    return null;
  }
}

// Helper function to query Vertex AI Search
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

// Helper function to query Google Custom Search
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

// Initialize Twilio client
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!TWILIO_PHONE_NUMBER || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error('Twilio credentials are missing from environment variables.');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Route to handle GET requests to the root
app.get('/', (req, res) => {
  res.send(`
    <h1>Welcome to JustBot API!</h1>
    <p>Your rights and resources are just a message away!</p>
  `);
});

// Route to handle incoming SMS
app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;

  // Get user's IP address
  const userIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '8.8.8.8';
  const processedIP = userIP === '::1' ? '8.8.8.8' : userIP;

  // Fetch user's location
  const userLocation = await getUserLocation(processedIP);
  const province = userLocation?.region || 'Unknown';
  console.log("User's Location:", province);

  // Handle "about bot" query
  if (Body.toLowerCase().includes('about bot')) {
    return res.status(200).send(`
      <Response>
        <Message>Welcome to JustBot! Ask me anything about your rights or protections based on your location.</Message>
      </Response>
    `);
  }

  try {  
    // Query Dialogflow for a new query
    const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, From || 'default-session');
    const dialogflowResponse = await dialogflowClient.detectIntent({
      session: sessionPath,
      queryInput: {
        text: { text: Body, languageCode: 'en' },
      },
    });
    const queryResult = dialogflowResponse[0].queryResult;
    const intentResponse = queryResult.fulfillmentText || "I couldn't find an exact match. Let me know more!";

    // Query additional resources
    const vertexResults = await queryVertexAI(Body, province);
    const googleResults = await queryGoogleCustomSearch(Body, province);
    const combinedResults = [...vertexResults, ...googleResults].slice(0, 3);

    const responseText = combinedResults.length
      ? combinedResults.map(result => `${result.title}: ${result.snippet}`).join('\n\n')
      : intentResponse;

    // Save response to Firestore
    await responsesCollection.add({
      phoneNumber: From,
      userInput: Body,
      intent: queryResult.intent?.displayName || 'Unknown',
      response: responseText,
    });

    return res.status(200).send(`
      <Response>
        <Message>${responseText}</Message>
      </Response>
    `);
  } catch (error) {
    console.error('Error processing SMS:', error);
    return res.status(500).send(`
      <Response>
        <Message>Sorry, something went wrong. Please try again later.</Message>
      </Response>
    `);
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
