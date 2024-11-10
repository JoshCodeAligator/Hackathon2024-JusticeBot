// config/dialogflow.js
const { SessionsClient } = require('@google-cloud/dialogflow');
const { searchDocuments } = require('../services/documentSearch');

const sessionClient = new SessionsClient({
  keyFilename: './config/firebase-admin-key.json', // Ensure the key file exists for Dialogflow
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

  const responses = await sessionClient.detectIntent(request);
  const result = responses[0].queryResult;

  // If Dialogflow recognizes an intent to fetch from documents
  if (result.intent && result.intent.displayName === 'DocumentSearchIntent') {
    const documentResults = searchDocuments(result.queryText);
    if (documentResults.length > 0) {
      return {
        fulfillmentText: `Here is what I found in the Alberta documents:\n${documentResults
          .map(doc => `${doc.fileName}: ${doc.textSnippet}`)
          .join('\n')}`,
      };
    } else {
      return { fulfillmentText: "I'm sorry, I couldn't find any relevant information in the Alberta documents." };
    }
  }

  return result;
}

module.exports = detectIntent;
