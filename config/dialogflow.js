// config/dialogflow.js
const { SessionsClient } = require('@google-cloud/dialogflow');

const sessionClient = new SessionsClient();

async function detectIntent(projectId, sessionId, query, languageCode = 'en') {
  if (!projectId) {
    throw new Error('Project ID is required');
  }
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: query, // The query text (user message)
        languageCode,
      },
    },
  };

  const responses = await sessionClient.detectIntent(request);
  return responses[0].queryResult;
}

module.exports = detectIntent;
