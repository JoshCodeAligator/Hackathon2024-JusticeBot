const { SessionsClient } = require('@google-cloud/dialogflow');
const path = require('path');

// Initialize Dialogflow SessionsClient
const sessionClient = new SessionsClient({
  keyFilename: path.join(__dirname, '../firebase-admin-key.json'), // Path to Firebase credentials
});

async function detectIntent(projectId, sessionId, query, languageCode = 'en') {
  const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: query,
        languageCode,
      },
    },
  };

  try {
    // Send request to Dialogflow and get responses
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;

    // Check if the intent is related to Alberta document search
    const isAlbertaDocumentSearch = result.intent?.displayName === 'Alberta Document Search';

    // Return query result with an additional field to indicate if document search is needed
    return {
      fulfillmentText: result.fulfillmentText,
      intent: result.intent.displayName,
      isAlbertaDocumentSearch, // Flag to indicate Alberta-specific search intent
      queryText: result.queryText,
    };
  } catch (error) {
    console.error('Dialogflow request error:', error);
    throw error;
  }
}

module.exports = detectIntent;
