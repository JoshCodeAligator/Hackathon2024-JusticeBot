// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const { searchDocuments } = require('../services/documentSearch');

router.post('/', async (req, res) => {
  const { queryResult } = req.body;
  const userMessage = queryResult.queryText;
  const intentName = queryResult.intent.displayName;

  let responseMessage;
  if (intentName === 'DocumentSearchIntent') {
    const documentResults = searchDocuments(userMessage);
    responseMessage = documentResults.length
      ? documentResults.map(doc => `${doc.fileName}: ${doc.snippet}`).join('\n')
      : "I couldn't find any relevant information in the documents.";
  } else {
    responseMessage = "I'm here to help, but I didn't understand that fully.";
  }

  res.json({
    fulfillmentText: responseMessage,
  });
});

module.exports = router;
