const db = require('../config/firebase');
const twilioClient = require('../config/twilio');
const detectIntent = require('../config/dialogflow');
const { searchDocuments } = require('../services/documentSearch');

async function handleIncomingSMS(req, res) {
  // Log to verify request payload
  console.log(req.body);

  const { Body, From } = req.body;

  if (!Body || !From) {
    console.error('Invalid message: missing Body or From');
    return res.status(400).json({ error: 'Invalid message: Body and From are required' });
  }

  const userRef = db.collection('users').doc(From);

  try {
    await userRef.set({ phoneNumber: From }, { merge: true });
    await userRef.update({
      chatHistory: admin.firestore.FieldValue.arrayUnion({
        text: Body,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }),
    });
    console.log('Message logged to Firestore');
  } catch (error) {
    console.error('Error logging message to Firestore:', error);
    return res.status(500).send('Error logging message');
  }

  let responseMessage;
  try {
    const dialogflowResponse = await detectIntent(process.env.DIALOGFLOW_PROJECT_ID, From, Body);
    const { fulfillmentText, isAlbertaDocumentSearch } = dialogflowResponse;

    if (isAlbertaDocumentSearch) {
      const searchResults = searchDocuments(Body);
      responseMessage = searchResults.length
        ? searchResults.map(result => `Found in ${result.fileName}:\n${result.snippet}`).join('\n\n')
        : "Sorry, I couldn't find any information related to that in Alberta government documents.";
    } else {
      responseMessage = fulfillmentText || "I'm not sure how to respond to that.";
    }

    await twilioClient.messages.create({
      body: responseMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: From,
    });

    res.status(200).send('Message sent!');
  } catch (error) {
    console.error('Error processing or sending message:', error);
    res.status(500).send('Error processing or sending message');
  }
}

module.exports = {
  handleIncomingSMS,
};
