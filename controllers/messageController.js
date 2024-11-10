// controllers/messageController.js
const Message = require('../models/Message');
const twilioClient = require('../config/twilio');
const detectIntent = require('../config/dialogflow');

async function handleIncomingSMS(req, res) {
  const { Body, From } = req.body;

  if (!Body || !From) {
    console.error('Invalid message: missing Body or From');
    return res.status(400).json({ error: 'Invalid message: Body and From are required' });
  }

  // Log the message to MongoDB
  try {
    const message = new Message({
      phoneNumber: From,
      text: Body,
    });
    await message.save();
    console.log('Message logged to MongoDB');
  } catch (error) {
    console.error('Error logging message to MongoDB:', error);
    return res.status(500).send('Error logging message');
  }

  // Process the message with Dialogflow and send a response
  try {
    const dialogflowResponse = await detectIntent(process.env.DIALOGFLOW_PROJECT_ID, From, Body);
    const responseMessage = dialogflowResponse.fulfillmentText || "I'm not sure how to respond to that.";

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
