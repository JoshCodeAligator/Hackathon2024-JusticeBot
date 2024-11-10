const { SessionsClient } = require('@google-cloud/dialogflow');

const sessionClient = new SessionsClient();

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
  return responses[0].queryResult;
}

module.exports = detectIntent;
