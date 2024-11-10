// controllers/messageController.js
const Message = require('../models/Message');
const twilioClient = require('../config/twilio');
const { searchDocuments } = require('../services/documentSearch'); // JSON search service

async function handleIncomingSMS(req, res) {
  const { Body: queryText, From } = req.body;

  if (!queryText || !From) {
    console.error('Invalid message: missing Body or From');
    return res.status(400).json({ error: 'Invalid message: Body and From are required' });
  }

  // Save the incoming message to MongoDB
  try {
    const message = new Message({ phoneNumber: From, text: queryText });
    await message.save();
    console.log('Message logged to MongoDB');
  } catch (error) {
    console.error('Error logging message to MongoDB:', error);
    return res.status(500).send('Error logging message');
  }

  // Perform JSON search and generate a response
  try {
    console.log('Searching JSON documents for:', queryText);
    const searchResults = await searchDocuments(queryText); // Search the JSON files with the query

    // Construct response from search results
    let responseMessage = 'No relevant information found in Alberta government documents.';
    if (searchResults && searchResults.length > 0) {
      responseMessage = searchResults
        .map((result, index) => `Result ${index + 1} from ${result.fileName}:\n"${result.snippet}"`)
        .join('\n\n');
    }

    console.log('Response Message:', responseMessage);

    // Send the response via Twilio
    if (responseMessage.trim()) {
      await twilioClient.messages.create({
        body: responseMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: From,
      });
      res.status(200).send('Message sent!');
    } else {
      console.error('No response message to send.');
      res.status(400).send('No response message to send.');
    }
  } catch (error) {
    console.error('Error processing or sending message:', error);
    res.status(500).send('Error processing or sending message');
  }
}

module.exports = {
  handleIncomingSMS,
};

