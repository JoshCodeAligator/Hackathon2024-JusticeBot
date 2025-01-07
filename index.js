const axios = require('axios');
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { SearchServiceClient } = require('@google-cloud/discoveryengine');
const firebaseAdmin = require('firebase-admin');
require('dotenv').config();

// Initialize Firestore
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.applicationDefault(),
});
const db = firebaseAdmin.firestore();
const cacheCollection = db.collection('queryCache');

// Validate environment variables
const requiredEnvVars = [
  'TWILIO_PHONE_NUMBER',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'DIALOGFLOW_PROJECT_ID',
  'GOOGLE_CSE_API_KEY',
  'GOOGLE_CSE_ID',
  'IPINFO_API_KEY',
  'OPENAI_API_KEY',  // Make sure to include OpenAI API key
];

requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`${key} is missing.`);
    process.exit(1);
  }
});

const discoveryClient = new SearchServiceClient({
  apiEndpoint: 'us-discoveryengine.googleapis.com',
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send(`
    <h1>Welcome to JusticeBot API!</h1>
    <p>We’re here to help you understand your rights and protections, especially under Alberta’s Human Rights framework. Just send a message, and our chatbot will provide the information you need or direct you to helpful resources. Your privacy is important to us, and we track common questions to respond faster in the future.</p>
    <p>How can I assist you today?</p>
  `);
});

const preprocessQuery = (query) => {
  const stopWords = ['the', 'is', 'at', 'which', 'on', 'in', 'and'];
  return query
    .trim()
    .toLowerCase()
    .split(' ')
    .filter((word) => !stopWords.includes(word))
    .join(' ');
};

async function getUserLocation(ip) {
  const API_KEY = process.env.IPINFO_API_KEY;
  try {
    const response = await axios.get(`https://ipinfo.io/${ip}/json?token=${API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching location:', error);
    return { region: 'Unknown' };
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
    const results = (response.data.items || []).map((item) => ({
      source: 'GoogleCSE',
      content: `${item.title}: ${item.snippet.slice(0, 300)}...`, // Limit snippet length
    }));

    // Fallback if no results
    if (results.length === 0) {
      results.push({
        source: 'GoogleCSE',
        content: `No relevant information found in the Google search for your query. Please provide more details.`,
      });
    }
    return results;
  } catch (error) {
    console.error('Error querying Google Custom Search API:', error);
    return [{
      source: 'GoogleCSE',
      content: `Error occurred while querying Google Custom Search. Please try again later.`,
    }];
  }
}

const prioritizeResponses = (responses) => {
  const weights = {
    Dialogflow: 3,
    GoogleCSE: 2,
  };
  return responses.sort((a, b) => weights[b.source] - weights[a.source]);
};

// **Updated to use OpenAI API for summarization and context generation**
async function summarizeResponsesWithOpenAI(responses, location, intent) {
  if (responses.length === 0) {
    return `Sorry, I couldn't find relevant information for your query. Please try again with more details.`;
  }

  const API_KEY = process.env.OPENAI_API_KEY;  // Use OpenAI API Key

  // Limit the number of responses
  const maxResponseCount = 5;
  const limitedResponses = responses.slice(0, maxResponseCount);

  // Truncate responses if they are too long
  const trimmedResponses = limitedResponses.map((response) => {
    const maxLength = 500;  // Limit each response to 500 characters
    return response.length > maxLength ? response.slice(0, maxLength) + '...' : response;
  });

  const prompt = `
You are a chatbot assistant. Summarize the following responses concisely for a user located in ${location}:

- Responses: ${trimmedResponses.join('\n')}

Provide a concise, helpful, and actionable response.
`;

  try {
    const summary = await axios.post(
      'https://api.openai.com/v1/completions',  // OpenAI Completion endpoint
      {
        model: 'gpt-3.5-turbo',  // Make sure to use gpt-3.5-turbo (no gpt-4 here)
        prompt: prompt,
        max_tokens: 150,
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
      }
    );
    return summary.data.choices[0].text.trim();
  } catch (error) {
    console.error('Error summarizing responses with OpenAI:', error);
    return `I couldn't summarize the information for you. Please try again later.`;
  }
}

const contextualizeResponse = (response, location, intent) => {
  const locationText = location !== 'Unknown' ? `specific to users in ${location}` : 'relevant to all users';
  const suggestions = intent === 'Find-Lawyer'
    ? 'Consider reaching out to legal aid services in your region for immediate help.'
    : 'You can also explore related resources or contact support for further assistance.';

  return `${response}\n\nThis response is ${locationText}. Detected intent: ${intent || 'Unknown'}. ${suggestions}`;
};

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const dialogflowClient = new SessionsClient();

app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;
  const userQuery = preprocessQuery(Body);
  const userIP = req.ip || '8.8.8.8';

  const cacheKey = `${From}_${userQuery}`;
  const cachedDoc = await cacheCollection.doc(cacheKey).get();

  if (cachedDoc.exists) {
    const cachedResponse = cachedDoc.data().response;
    return res.status(200).send(`<Response><Message>${cachedResponse}</Message></Response>`);
  }

  const userLocation = await getUserLocation(userIP);
  const province = userLocation?.region || 'Unknown';
  const sessionId = From || 'default-session-id';
  const sessionPath = dialogflowClient.projectAgentSessionPath(process.env.DIALOGFLOW_PROJECT_ID, sessionId);

  try {
    const dialogflowRequest = {
      session: sessionPath,
      queryInput: {
        text: {
          text: Body,
          languageCode: 'en',
        },
      },
    };

    const dialogflowResponses = await dialogflowClient.detectIntent(dialogflowRequest);
    const queryResult = dialogflowResponses[0].queryResult;
    const intent = queryResult.intent?.displayName || 'Unknown';

    // Fallback logic for Dialogflow response
    const intentResponse = queryResult.fulfillmentText || `I could not find specific information about "${intent}". Can you please clarify your query?`;

    // Fetch legal resources from Google Custom Search
    const googleResults = await queryGoogleCustomSearch(userQuery, province);

    const allResponses = prioritizeResponses([
      { source: 'Dialogflow', content: intentResponse },
      ...googleResults,
    ].map((r) => r.content));

    const summarizedResponse = await summarizeResponsesWithOpenAI(allResponses, province, intent);
    const tailoredResponse = contextualizeResponse(summarizedResponse, province, intent);

    await cacheCollection.doc(cacheKey).set({
      response: tailoredResponse,
      timestamp: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).send(`<Response><Message>${tailoredResponse}</Message></Response>`);
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).send(
      `<Response><Message>There was an error processing your request. Please try again later.</Message></Response>`
    );
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
