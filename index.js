const axios = require('axios');
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { SearchServiceClient } = require('@google-cloud/discoveryengine');
const firebaseAdmin = require('firebase-admin');
const Redis = require('ioredis');
require('dotenv').config();

// Initialize Redis
const redis = new Redis();

// Validate environment variables
const requiredEnvVars = [
  'TWILIO_PHONE_NUMBER',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'DIALOGFLOW_PROJECT_ID',
  'GOOGLE_CSE_API_KEY',
  'GOOGLE_CSE_ID',
  'IPINFO_API_KEY',
  'OPENAI_API_KEY',
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
    <h1>Welcome to JustBot API!</h1>
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

async function queryVertexAI(query, location) {
  const searchQuery = `${query} in ${location}`;
  const request = {
    servingConfig: 'projects/justicebot-441223/locations/us/dataStores/static-docs-search_1735535987304/servingConfigs/default_config',
    query: searchQuery,
  };

  try {
    const [response] = await discoveryClient.search(request);
    return (response.results || []).map((result) => ({
      source: 'VertexAI',
      content: `${result.document.title}: ${result.document.snippet}`,
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
    return (response.data.items || []).map((item) => ({
      source: 'GoogleCSE',
      content: `${item.title}: ${item.snippet}`,
    }));
  } catch (error) {
    console.error('Error querying Google Custom Search API:', error);
    return [];
  }
}

const prioritizeResponses = (responses) => {
  const weights = {
    Dialogflow: 3,
    VertexAI: 2,
    GoogleCSE: 1,
  };
  return responses.sort((a, b) => weights[b.source] - weights[a.source]);
};

async function summarizeResponses(responses, location, intent) {
  const API_KEY = process.env.OPENAI_API_KEY;
  const prompt = `
You are a chatbot assistant. Summarize the following responses concisely while ensuring they are tailored to the user's query and location: 

- Location: ${location}
- Detected Intent: ${intent}
- Responses: ${responses.join('\n')}

Provide the most helpful and actionable response.
`;

  try {
    const summary = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.5,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
      }
    );
    return summary.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error summarizing responses:', error);
    return responses[0];
  }
}

const contextualizeResponse = (response, location, intent) => {
  const locationText = location !== 'Unknown' ? `specific to users in ${location}` : 'relevant to all users';
  const suggestions = intent === 'Find-Lawyer'
    ? 'Consider reaching out to legal aid services in your region for immediate help.'
    : 'You can also explore related resources or contact support for further assistance.';

  return `${response}\n\nThis response is ${locationText}. Detected intent: ${intent}. ${suggestions}`;
};

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.applicationDefault(),
});
const db = firebaseAdmin.firestore();
const responsesCollection = db.collection('responses');
const dialogflowClient = new SessionsClient();

app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;
  const userQuery = preprocessQuery(Body);
  const userIP = req.ip || '8.8.8.8';

  const cacheKey = `${From}_${userQuery}`;
  const cachedResponse = await redis.get(cacheKey);
  if (cachedResponse) {
    return res.status(200).send(`<Response><Message>${cachedResponse}</Message></Response>`);
  }

  const userLocation = await getUserLocation(userIP);
  const province = userLocation?.region || 'Unknown';
  const sessionId = From || 'default-session-id';
  const sessionPath = dialogflowClient.projectAgentSessionPath(process.env.DIALOGFLOW_PROJECT_ID, sessionId);

  try {
    const existingQuery = await responsesCollection
      .where('phoneNumber', '==', From)
      .where('userInput', '==', Body)
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      const savedResponse = existingQuery.docs[0].data().response;
      await redis.set(cacheKey, savedResponse, 'EX', 3600); // Cache for 1 hour
      return res.status(200).send(`<Response><Message>${savedResponse}</Message></Response>`);
    }

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
    const intentResponse = queryResult.fulfillmentText || "I'm here to help! Could you clarify what you're looking for?";

    const vertexResults = await queryVertexAI(userQuery, province);
    const googleResults = await queryGoogleCustomSearch(userQuery, province);

    const allResponses = prioritizeResponses([
      { source: 'Dialogflow', content: intentResponse },
      ...vertexResults,
      ...googleResults,
    ].map((r) => r.content));

    const summarizedResponse = await summarizeResponses(allResponses, province, intent);
    const tailoredResponse = contextualizeResponse(summarizedResponse, province, intent);

    await responsesCollection.add({
      phoneNumber: From,
      userInput: Body,
      intent,
      response: tailoredResponse,
    });

    await redis.set(cacheKey, tailoredResponse, 'EX', 3600); // Cache for 1 hour
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
