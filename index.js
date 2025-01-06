const axios = require('axios');
const express = require('express');
const twilio = require('twilio');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { SearchServiceClient } = require('@google-cloud/discoveryengine');
const firebaseAdmin = require('firebase-admin');
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

const preprocessQuery = (query) => query.trim().toLowerCase();

async function getUserLocation(ip) {
  const API_KEY = process.env.IPINFO_API_KEY;
  try {
    const response = await axios.get(`https://ipinfo.io/${ip}/json?token=${API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching location:', error);
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
    if (response.results && Array.isArray(response.results)) {
      return response.results.map(result => ({
        title: result.document.title,
        snippet: result.document.snippet,
      }));
    } else {
      console.error('No results found in Vertex AI Search response:', response);
      return [];
    }
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

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!TWILIO_PHONE_NUMBER || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error('Twilio credentials are missing.');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

try {
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.applicationDefault(),
  });
  console.log('Firebase Admin SDK initialized.');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1);
}

const db = firebaseAdmin.firestore();
const responsesCollection = db.collection('responses');

const dialogflowClient = new SessionsClient();
const projectId = process.env.DIALOGFLOW_PROJECT_ID;

if (!projectId) {
  console.error('DIALOGFLOW_PROJECT_ID is not set.');
  process.exit(1);
}

const summarizeResponses = async (responses) => {
  try {
    const combinedText = responses.join(' ');
    const summary = await axios.post('https://api.openai.com/v1/completions', {
      prompt: `Summarize this information into one concise and relevant response: ${combinedText}`,
      max_tokens: 100,
      temperature: 0.7,
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    return summary.data.choices[0].text.trim();
  } catch (error) {
    console.error('Error summarizing responses:', error);
    return responses[0];
  }
};

const contextualizeResponse = (response, location, intent) => {
  const locationText = location !== 'Unknown' ? `specific to users in ${location}` : 'relevant to all users';
  return `${response}

This response is ${locationText}. Detected intent: ${intent}.`;
};

app.post('/sms', async (req, res) => {
  const { Body, From } = req.body;
  const userQuery = preprocessQuery(Body);
  const userIP = req.ip || '8.8.8.8';

  const userLocation = await getUserLocation(userIP);
  const province = userLocation?.region || 'Unknown';
  const sessionId = From || 'default-session-id';
  const sessionPath = dialogflowClient.projectAgentSessionPath(projectId, sessionId);

  try {
    const existingQuery = await responsesCollection
      .where('phoneNumber', '==', From)
      .where('userInput', '==', Body)
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      const savedResponse = existingQuery.docs[0].data().response;
      return res.status(200).send(
        `<Response>
          <Message>Welcome back! Here’s the info we previously shared: ${savedResponse}</Message>
        </Response>`
      );
    } else {
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
      const intent = queryResult.intent?.displayName || 'Unknown';
      const intentResponse = queryResult.fulfillmentText || "I'm here to help! Could you clarify what you're looking for?";

      const vertexResults = await queryVertexAI(userQuery, province);
      const googleResults = await queryGoogleCustomSearch(userQuery, province);

      const allResponses = [
        intentResponse,
        ...vertexResults.map(res => `${res.title}: ${res.snippet}`),
        ...googleResults.map(res => `${res.title}: ${res.snippet}`),
      ];

      const summarizedResponse = await summarizeResponses(allResponses);
      const tailoredResponse = contextualizeResponse(summarizedResponse, province, intent);

      await responsesCollection.add({
        phoneNumber: From,
        userInput: Body,
        intent: intent,
        response: tailoredResponse,
      });

      return res.status(200).send(
        `<Response>
          <Message>${tailoredResponse}</Message>
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
